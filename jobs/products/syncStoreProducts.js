import logger from "#common-functions/logger/index.js";
import Products from "#schemas/products.js";
import Stores from "#schemas/stores.js";
import executeShopifyQueries from "#common-functions/shopify/execute.js";
import { SEARCH_PRODUCTS } from "#common-functions/shopify/queries.js";

const processingTemp = {};
const fetchAllProducts = async ({ accessToken, shopUrl }) => {
  if (!processingTemp[shopUrl]) {
    processingTemp[shopUrl] = true;
  } else {
    logger("error", "Service already process the store");
    return;
  }

  let allProducts = [];
  let hasNextPage = true;
  let cursor = null;
  let realData = undefined;
  let realPageInfo = undefined;

  logger("info", "Starting to fetch products");
  while (hasNextPage) {
    try {
      const { data, pageInfo } = await executeShopifyQueries({
        accessToken,
        query: SEARCH_PRODUCTS,
        storeUrl: shopUrl,
        variables: {
          first: 250,
          after: cursor,
        },
        callback: (result) => {
          const { edges, pageInfo } = result.data.products;
          const formattedData = edges.map(({ node }) => ({
            id: node.id,
            title: node.title,
            description: node.description,
            descriptionHtml: node.descriptionHtml,
            vendor: node.vendor,
            productType: node.productType,
            tags: node.tags,
            customProductType: node.customProductType,
            isGiftCard: node.isGiftCard,
            onlineStoreUrl: node.onlineStoreUrl,
            images: node.images.edges.map(({ node: imageNode }) => ({
              src: imageNode.src,
              altText: imageNode.altText || null,
            })),
            status: node.status,
            options: node.options,
            variants: node.variants.edges.map(({ node: variantNode }) => ({
              id: variantNode.id,
              title: variantNode.title,
              price: variantNode.price,
              sku: variantNode.sku || null,
              inventoryQuantity: variantNode.inventoryQuantity || null,
            })),
          }));
          logger(
            "info",
            `Successfully fetched: ${formattedData.length} products.`
          );
          return {
            data: formattedData,
            pageInfo,
          };
        },
      });

      realData = data;
      realPageInfo = pageInfo;
    } catch (e) {
      logger(
        "error",
        `[sync-store-products [fetch-all-products]] Error fetching products from Shopify: ${error}`
      );
      throw new Error(error);
    }

    allProducts = [...allProducts, ...realData];
    hasNextPage = realPageInfo.hasNextPage;
    cursor = realPageInfo.endCursor;

    await sleep(1000);
  }
  delete processingTemp[shopUrl];
  return allProducts;
};

const SyncStoreProducts = async () => {
  try {
    logger("info", "Running cron to sync products of stores.");

    const unsyncedStores = await Stores.find({
      isProductsSynced: false,
      isActive: true,
      isInternalStore: false,
    }).lean();

    if (!unsyncedStores || !unsyncedStores.length) {
      logger("info", "No stores found to sync products for");
      return;
    }

    await Promise.all(
      unsyncedStores
        .map(async (store) => {
          try {
            if (!store?.accessToken) {
              throw new Error("No access token");
            }
            const allProducts = await fetchAllProducts({
              accessToken: store.accessToken,

              shopUrl: store.storeUrl,
            });

            if (!allProducts || !allProducts.length) {
              return;
            }
            const storeProductObjs = allProducts
              .map((product) => {
                if (product.status === "DRAFT") {
                  return null;
                }
                let totalInventory = 0;
                product.variants.forEach(
                  (v) => (totalInventory += Number(v.inventoryQuantity ?? 0))
                );
                return {
                  productId: product.id,
                  title: product.title,
                  bodyHtml: product.descriptionHtml || "",
                  createdAt: product.createdAt || new Date(),
                  updatedAt: product.updatedAt || new Date(),
                  handle: product.handle || "",
                  description: product.description || "",
                  descriptionHtml: product.descriptionHtml || "",
                  vendor: product.vendor || "",
                  productType: product.productType || "",
                  tags: product.tags || [],
                  totalInventory: totalInventory,
                  totalVariants: product.variants?.length || 0,
                  onlineStoreUrl: product.onlineStoreUrl || "",
                  customProductType: product.customProductType || "",
                  isGiftCard: product.isGiftCard || false,
                  images: product.images || [],
                  variants: product.variants || [],
                  store: store._id,
                  options: product.options,
                  length: "",
                  width: "",
                  weight: "",
                  height: "",
                };
              })
              .filter(Boolean);

            await Promise.all([
              Products.insertMany(storeProductObjs),
              Stores.findByIdAndUpdate(store._id, { isProductsSynced: true }),
            ]);

            logger(
              "info",
              `Successfully synced products for store: ${store.shopName}`
            );
          } catch (error) {
            logger(
              "error",
              `Error syncing products for store: ${store.shopName}`,
              error
            );
          }
        })
        .filter(Boolean)
    );

    logger("info", "Completed syncing products for all unsynced stores.");
  } catch (e) {
    logger(
      "error",
      "[sync-store-products] Error when syncing the products to the database",
      e
    );
  }
};

setInterval(() => {
  SyncStoreProducts();
}, process.env.SYNC_BUNDLE_WORKER_INTERVAL_MS);

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export default SyncStoreProducts;
