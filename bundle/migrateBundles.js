import cron from "node-cron";
import Bundle from "#schemas/bundles.js";
import Products from "#schemas/products.js";
import CreateProductStore from "#common-functions/shopify/createStoreProducts.service.js";
import logger from "#common-functions/logger/index.js";
import Stores from "#schemas/stores.js";
import { BUNDLE_STATUSES } from "../constants/bundle/index.js";

let SERVICE_RUNNING = false;

const MigrateBundlesToShopify = async () => {
  try {
    if (SERVICE_RUNNING) {
      logger("info", "Service is already running.");
      return;
    }

    SERVICE_RUNNING = true;

    const activeBundles = await Bundle.find({
      status: BUNDLE_STATUSES.ACTIVE,
      isCreatedOnShopify: false,
    })
      .populate("store")
      .lean();

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
                const internalProduct = await CreateProductStore({
                  bundle,
                  accessToken: store.accessToken,
                  shopName: store.shopName,
                  products,
                  isInternal: true,
                });
                const vendorProduct = await CreateProductStore({
                  bundle,
                  accessToken: bundle.store.accessToken,
                  shopName: bundle.store.shopName,
                  products,
                  isInternal: false,
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
