import BundleCreationCron from "./store/createStoreBundles.js";
import BundleMigrationCron from "./bundle/migrateBundles.js";
const StartJobs = () => {
  BundleCreationCron();
  // BundleMigrationCron();
};

export default StartJobs;
