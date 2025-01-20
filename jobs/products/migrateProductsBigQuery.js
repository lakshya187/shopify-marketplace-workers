import logger from "#common-functions/logger/index.js";
import Products from "#schemas/products.js";
import { BigQuery } from "@google-cloud/bigquery";
import Bundles from "#schemas/bundles.js";

const bigquery = new BigQuery({
  projectId: process.env.GCP_PROJECT_ID,
  keyFilename: process.env.GCP_SERVICE_ACCOUNT_CREDENTIALS,
});

const MigrateBundlesToBQ = async () => {
  try {
    logger("info", "Running CRON to migrate Products to BQML");

    // find bundles not synced to BQ
    const bundlesToProcess = await Bundles.find({
      isCreatedOnBQ: false,
      isCreatedOnShopify: true,
      status: "active",
    }).lean();

    if (!bundlesToProcess || !bundlesToProcess.length)
      return logger("info", "No products found to migrate to BQML");

    logger("info", "Bundles to migrate :" + bundlesToProcess.length);

    const formattedDocs = bundlesToProcess
      .map((p) => {
        return formatBundle(p);
      })
      .filter(Boolean);

    logger("info", "formatted docs to process: " + formattedDocs.length);
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

      // mark bundles as synced in MongoDB
      const bundleIds = bundlesToProcess.map((p) => p._id);
      await Bundles.updateMany(
        { _id: { $in: bundleIds } },
        { $set: { isCreatedOnBQ: true } }
      );
      logger("info", "Successfully updated MongoDB for synced products.");
    } else {
      logger("info", "No embeddings generated.");
    }
  } catch (e) {
    logger("error", "[migrate-bundles-to-bq]", e);
  }
};
setInterval(() => {
  MigrateBundlesToBQ();
}, process.env.MIGRATE_BUNDLES_BQ_WORKER_INTERVAL_MS);

export default MigrateBundlesToBQ;

// module specific fn
const formatBundle = (bundle) => {
  const cleanBodyHtml = bundle.description
    ? bundle.description
        .replace(/<\/?[^>]+(>|$)/g, "") // Remove HTML tags
        .replace(/(\r\n|\n|\r)/gm, "") // Remove newlines
        .replace(/"/g, '\\"') // Escape quotes
    : null;

  // Build the embedding string
  const embeddingStr = `
This text represents a gifting bundle for a semantic search system. 
The gifting bundle is described as follows: 
- Title: ${bundle.name}
- Description: ${cleanBodyHtml || "No description provided."}
- Price: ${bundle.price}
${
  bundle.tags && bundle.tags.length
    ? `- Tags: ${bundle.tags.join(", ")}`
    : "- Tags: None"
}
`.trim();

  return {
    id: bundle._id.toString(),
    content: embeddingStr,
  };
};

const generateEmbeddings = async (formattedDocs) => {
  try {
    const location = process.env.GCP_LOCATION;

    const embeddedDocs = [];
    for (const bundle of formattedDocs) {
      try {
        const { id, content } = bundle;
        const query = `
        SELECT  
        ml_generate_embedding_result
        FROM
        ML.GENERATE_EMBEDDING(
          MODEL ${"`"}${process.env.GCP_PROJECT_ID}.${
          process.env.GCP_BQ_DATA_SET_ID
        }.${process.env.GCP_MODEL_ID}${"`"},
            (SELECT '''${content}''' AS content)
            )
            `;
        const options = {
          query,
          location,
        };
        const [row] = await bigquery.query(options);
        embeddedDocs.push({
          id,
          content,
          embeddings: row[0].ml_generate_embedding_result,
        });
        logger("info", `Successfully generated the embeddings for ${id}`);
      } catch (e) {
        logger("error", `Error when generating embeddings for ${bundle.id}`, e);
      }
    }

    return embeddedDocs;
  } catch (e) {
    logger(
      "error",
      "[generate-embeddings] Error when generating embeddings",
      e
    );
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
