import BundleCreationCron from "./store/createStoreBundles.js";

const StartJobs = () => {
  BundleCreationCron();
};

export default StartJobs;
