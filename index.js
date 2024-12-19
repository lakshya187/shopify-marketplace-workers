import CreateStoreBundles from "./bundle/createStoreBundles.js";
import MigrateBundlesToShopify from "./bundle/migrateBundles.js";
import SyncStoreProducts from "./bundle/syncStoreProducts.js";
import UpdateMedia from "./bundle/updateMedia.js";
const StartJobs = () => {
  // CreateStoreBundles();
  MigrateBundlesToShopify();
  SyncStoreProducts();
  UpdateMedia();
};
StartJobs();
