import logger from "#common-functions/logger/index.js";
import Products from "#schemas/products.js";
import Stores from "#schemas/stores.js";
import executeShopifyQueries from "#common-functions/shopify/execute.js";
import { SEARCH_PRODUCTS } from "#common-functions/shopify/queries.js";

const fetchAllProducts = async ({ accessToken, shopUrl }) => {
  let allProducts = [];
  let hasNextPage = true;
  let cursor = null;

  while (hasNextPage) {
    try {
      const { data, pageInfo } = await executeShopifyQueries({
        accessToken,
        query: SEARCH_PRODUCTS,
        storeUrl,
        variables: {
          first: 250,
          after: cursor, // Pagination cursor
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
            variants: node.variants.edges.map(({ node: variantNode }) => ({
              id: variantNode.id,
              title: variantNode.title,
              price: variantNode.price,
              sku: variantNode.sku || null,
              inventoryQuantity: variantNode.inventoryQuantity || null,
            })),
          }));
          return {
            data: formattedData,
            pageInfo,
          };
        },
      });
    } catch (e) {
      logger(
        "error",
        `[sync-store-products [fetch-all-products]] Error fetching products from Shopify: ${error}`
      );
      throw new Error(error);
    }

    allProducts = [...allProducts, ...data];
    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

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
      unsyncedStores.map(async (store) => {
        try {
          const allProducts = await fetchAllProducts({
            accessToken: store.accessToken,

            shopUrl: store.storeUrl,
          });

          const storeProductObjs = allProducts.map((product) => {
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
              length: "",
              width: "",
              weight: "",
              height: "",
            };
          });

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

export default SyncStoreProducts;
