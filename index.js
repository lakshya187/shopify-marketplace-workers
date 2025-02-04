import MigrateBundlesToShopify from "./jobs/bundles/migrateBundlesMarketplace.js";
// import SyncStoreProducts from "./jobs/products/syncStoreProducts.js";
// import UpdateMedia from "./jobs/bundles/updateMedia.js";
// import MigrateProductsToBQ from "./jobs/bundles/MigrateBundlesBQ.js";
// import CreateRecommendedBundles from "./jobs/bundles/createRecommendedBundles.js";
const StartJobs = () => {
  // CreateRecommendedBundles();
  MigrateBundlesToShopify();
  // SyncStoreProducts();
  // UpdateMedia();
  // MigrateProductsToBQ();
};
StartJobs();
