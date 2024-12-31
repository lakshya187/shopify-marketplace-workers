import MigrateBundlesToShopify from "./jobs/bundles/migrateBundlesMarketplace.js";
import SyncStoreProducts from "./jobs/products/syncStoreProducts.js";
import UpdateMedia from "./jobs/bundles/updateMedia.js";
// import MigrateProductsToBQ from "./jobs/products/migrateProductsBigQuery.js";
const StartJobs = () => {
  MigrateBundlesToShopify();
  SyncStoreProducts();
  UpdateMedia();
  // MigrateProductsToBQ();
};
StartJobs();
