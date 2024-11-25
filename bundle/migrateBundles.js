import cron from "node-cron";
import Bundle from "#schemas/bundles.js";
import Products from "#schemas/products.js";
import CreateProductStore from "#common-functions/shopify/createStoreProducts.service.js";
import logger from "#common-functions/logger/index.js";
import Stores from "#schemas/stores.js";
import { BUNDLE_STATUSES } from "../constants/bundle/index.js";

const MigrateBundlesToShopify = async () => {
  try {
    const activeBundles = await Bundle.find({
      status: BUNDLE_STATUSES.ACTIVE,
      isCreatedOnShopify: false,
    }).lean();

    if (!activeBundles.length) {
      logger("info", "No active bundles to process.");
      return;
    }
    const activeBundleIds = activeBundles.map((bundle) => bundle._id);
    const productsForActiveBundles = await Products.find({
      bundle: { $in: activeBundleIds },
    }).lean();

    const productHash = convertArrayToObject(
      productsForActiveBundles,
      "bundle"
    );

    logger("info", `Found ${activeBundles.length} active bundles to process.`);
    const internalStores = await Stores.find({ isInternalStore: true }).lean();
    logger("info", `Found ${internalStores.length} stores found to process.`);

    if (internalStores.length) {
      await Promise.all(
        internalStores.map(async (store) => {
          const promises = activeBundles.map(async (bundle) => {
            try {
              const products = productHash[bundle._id];
              if (products.length) {
                const operation = await CreateProductStore({
                  bundle,
                  accessToken: store.accessToken,
                  shopName: store.shopName,
                  products,
                });

                logger("info", `Bundle created: Operation ID: ${operation.id}`);

                await Bundle.findByIdAndUpdate(bundle._id, {
                  isCreatedOnShopify: true,
                  shopifyProductId: operation.id,
                });
              }
            } catch (err) {
              logger(
                "error",
                `Failed to create product bundle for ${bundle._id}`,
                err
              );
            }
          });

          await Promise.all(promises);
        })
      );
    }
  } catch (err) {
    logger("error", "Error processing bundles", err);
  }
};

export default () => {
  cron.schedule("0/10 * * * * *", async () => {
    logger("info", "Running the product bundle creation job...");
    await MigrateBundlesToShopify();
  });
};

// utils
const convertArrayToObject = (data, key) => {
  const hash = {};
  data.forEach((d) => {
    if (!hash[d[key]]) {
      hash[d[key]] = [];
    }
    hash[d[key]].push(d);
  });
  return hash;
};
