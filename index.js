import CreateStoreBundles from "./bundle/createStoreBundles.js";
import MigrateBundlesToShopify from "./bundle/migrateBundles.js";
import SyncStoreProducts from "./bundle/syncStoreProducts.js";
const StartJobs = () => {
  // CreateStoreBundles();
  MigrateBundlesToShopify();
  SyncStoreProducts();
};
StartJobs();
