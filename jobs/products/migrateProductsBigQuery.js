import logger from "#common-functions/logger/index.js";
import Products from "#schemas/products.js";
import { BigQuery } from "@google-cloud/bigquery";

const bigquery = new BigQuery({ projectId: process.env.GCP_PROJECT_ID });

const MigrateProductsToBQ = async () => {
  try {
    logger("info", "Running CRON to migrate Products to BQML");

    // find products not synced to BQ
    const productsToProcess = await Products.find({
      isDeleted: false,
      isCreatedOnBQ: false,
    }).lean();

    if (!productsToProcess || !productsToProcess.length)
      return logger("info", "No products found to migrate to BQML");

    logger("info", "Products to migrate :" + productsToProcess.length);

    // format the docs
    const uniqueProductTitles = [];
    const formattedDocs = productsToProcess
      .map((p) => {
        if (p) {
          const isProductTitleUnique = !uniqueProductTitles.includes(p.title);

          if (isProductTitleUnique) {
            uniqueProductTitles.push(p.title);
            return formatProduct(p);
          }
        }
        return null;
      })
      .filter(Boolean);

    logger(
      "info",
      "Unique and formatted docs to process: " + formattedDocs.length
    );
    // update the data in bq dataset.
    const embeddingResults = await generateEmbeddings(formattedDocs);
    logger(
      "info",
      `Successfully generated the embeddings for ${embeddingResults.length} products`
    );

    if (embeddingResults && embeddingResults.length) {
      // update the data in bq embeddings
      await insertIntoBigQuery(embeddingResults);
      logger("info", "Successfully inserted data into BigQuery.");

      // mark products as synced in MongoDB
      const productIds = productsToProcess.map((p) => p._id);
      await Products.updateMany(
        { _id: { $in: productIds } },
        { $set: { isCreatedOnBQ: true } }
      );
      logger("info", "Successfully updated MongoDB for synced products.");
    } else {
      logger("info", "No embeddings generated.");
    }
  } catch (e) {
    logger("error", "[migrate-products-to-bq]", e);
  }
};
setInterval(() => {
  // MigrateProductsToBQ();
}, process.env.MIGRATE_BUNDLE_WORKER_INTERVAL_MS);

export default MigrateProductsToBQ;

// module specific fn
const formatProduct = (product) => {
  const cleanBodyHtml = product.description
    ? product.description
        .replace(/<\/?[^>]+(>|$)/g, "")
        .replace(/(\r\n|\n|\r)/gm, "")
        .replace(/"/g, '\\"')
    : null;
  const embeddingStr = `This is a component to a gifting bundle. The title is ${
    product.title
  } the description is ${cleanBodyHtml}. ${
    product.tags && product.tags.length
      ? `Tags are ${product.tags?.join(", ")}`
      : ""
  }`;
  return {
    id: product._id.toString(),
    content: embeddingStr,
  };
};

const generateEmbeddings = async (formattedDocs) => {
  try {
    const datasetId = process.env.GCP_BQ_DATA_SET_ID;
    const modelId = process.env.GCP_MODEL_ID;
    const tempTableName = process.env.GCP_TEMP_TABLE;

    // Insert data into the temporary table
    await bigquery
      .dataset(datasetId)
      .table(tempTableName)
      .insert(formattedDocs);

    // Generate embeddings using the temporary table
    const query = `
      SELECT
        id,
        JSON_EXTRACT(ml_generate_embedding_result, '$') AS embedding_result
      FROM
        ML.GENERATE_EMBEDDING(
          MODEL \`${datasetId}.${modelId}\`,
          (
            SELECT id, content FROM \`${datasetId}.${tempTableName}\`
          ),
          STRUCT(FALSE AS flatten_json_output)
        )
    `;
    const options = {
      query,
      location: "us-central1",
    };

    const [rows] = await bigquery.query(options);

    return rows.map((row) => {
      if (row) {
        const content = formattedDocs.find((doc) => doc.id === row.id);
        return {
          id: row.id,
          content: content?.content ?? "",
          embeddings: JSON.parse(row.embedding_result).predictions[0].embeddings
            .values,
        };
      }
    });
  } catch (e) {
    logger("error", "[generate-embeddings]", e);
    return [];
  }
};

// Insert data into BigQuery table
const insertIntoBigQuery = async (data) => {
  try {
    const datasetId = process.env.GCP_BQ_DATA_SET_ID;
    const tableId = process.env.GCP_EMBEDDINGS_TABLE;
    const BATCH_SIZE = Number(process.env.GCP_BATCH_SIZE);
    const dataChunks = chunkArray(data, BATCH_SIZE);

    for (const chunk of dataChunks) {
      const rows = chunk.map((row) => ({
        id: row.id,
        content: row.content,
        embeddings: row.embeddings,
      }));

      try {
        await bigquery.dataset(datasetId).table(tableId).insert(rows);
        logger(
          "info",
          `Successfully inserted ${rows.length} rows into BigQuery.`
        );
      } catch (chunkError) {
        logger(
          "error",
          `[insert-into-bigquery-batch] Failed batch insert`,
          chunkError
        );
      }
    }
  } catch (e) {
    logger("error", "[insert-into-bigquery]", e);
  }
};

const chunkArray = (array, size) =>
  array.reduce(
    (acc, _, i) => (i % size ? acc : [...acc, array.slice(i, i + size)]),
    []
  );
