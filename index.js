import CreateStoreBundles from "./bundle/createStoreBundles.js";
import MigrateBundlesToShopify from "./bundle/migrateBundles.js";

const StartJobs = () => {
  CreateStoreBundles();
  MigrateBundlesToShopify();
};
StartJobs();
