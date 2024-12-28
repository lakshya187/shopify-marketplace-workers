// import CreateStoreBundles from "./jobs/bundle/createStoreBundles.js";
// import MigrateBundlesToShopify from "./jobs/bundle/migrateBundlesMarketplace.js";
// import SyncStoreProducts from "./jobs/products/syncStoreProducts.js";
// import UpdateMedia from "./jobs/bundle/updateMedia.js";
import MigrateProductsToBQ from "./jobs/products/migrateProductsBigQuery.js";
const StartJobs = () => {
  // CreateStoreBundles();
  // MigrateBundlesToShopify();
  // SyncStoreProducts();
  // UpdateMedia();
  MigrateProductsToBQ();
};
StartJobs();
