import logger from "#common-functions/logger/index.js";
import SearchProductOnShopify from "#common-functions/shopify/getStoreProducts.js";
import Products from "#schemas/products.js";
import Stores from "#schemas/stores.js";

const fetchAllProducts = async ({ accessToken, shopName }) => {
  let allProducts = [];
  let hasNextPage = true;
  let cursor = null;

  while (hasNextPage) {
    const { data, success, error, pageInfo } = await SearchProductOnShopify({
      accessToken,
      shopName,
      numOfProducts: 20,
      searchTerm: "",
      cursor,
    });

    if (!success) {
      logger("error", `Error fetching products from Shopify: ${error}`);
      throw new Error(error);
    }

    // const { edges } = data.products;
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
            shopName: store.shopName,
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
}, process.env.MIGRATE_BUNDLE_WORKER_INTERVAL_MS);

export default SyncStoreProducts;
