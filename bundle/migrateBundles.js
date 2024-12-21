import cron from "node-cron";
import Bundle from "#schemas/bundles.js";
import Products from "#schemas/products.js";
import CreateProductStore from "#common-functions/shopify/createStoreProducts.js";
import logger from "#common-functions/logger/index.js";
import Stores from "#schemas/stores.js";
import { BUNDLE_STATUSES } from "../constants/bundle/index.js";
import Categories from "#schemas/categories.js";
import Boxes from "#schemas/boxes.js";

let SERVICE_RUNNING = false;

const MigrateBundlesToShopify = async () => {
  try {
    SERVICE_RUNNING = true;

    const activeBundles = await Bundle.find({
      status: BUNDLE_STATUSES.ACTIVE,
      isCreatedOnShopify: false,
    })
      .populate("store")
      .populate("category")
      .populate("box")
      .populate({ path: "components.product" })
      .lean();

    if (!activeBundles.length) {
      logger("info", "No active bundles to process.");
      return;
    }

    logger("info", `Found ${activeBundles.length} active bundles to process.`);
    const internalStores = await Stores.find({ isInternalStore: true }).lean();
    logger("info", `Found ${internalStores.length} stores found to process.`);

    if (internalStores.length) {
      await Promise.all(
        internalStores.map(async (store) => {
          const promises = activeBundles.map(async (bundle) => {
            try {
              const { components: products } = bundle;
              if (products.length) {
                const internalProduct = await CreateProductStore({
                  bundle,
                  accessToken: store.accessToken,
                  shopName: store.shopName,
                  products,
                  isInternal: true,
                  storeUrl: store.storeUrl,
                });
                const vendorProduct = await CreateProductStore({
                  bundle,
                  accessToken: bundle.store.accessToken,
                  shopName: bundle.store.shopName,
                  products,
                  isInternal: false,
                  storeUrl: bundle.store.storeUrl,
                });

                logger(
                  "info",
                  `Bundle created: Operation ID: ${internalProduct.id}`
                );
                const productMetaData = {
                  ...store.metadata,
                  vendorShopifyId: vendorProduct.id,
                };

                await Bundle.findByIdAndUpdate(bundle._id, {
                  isCreatedOnShopify: true,
                  shopifyProductId: internalProduct.id,
                  metadata: productMetaData,
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

    SERVICE_RUNNING = false;
  } catch (err) {
    logger("error", "Error processing bundles", err);
    SERVICE_RUNNING = false;
  }
};

setInterval(() => {
  MigrateBundlesToShopify();
}, process.env.MIGRATE_BUNDLE_WORKER_INTERVAL_MS);

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

export default MigrateBundlesToShopify;
