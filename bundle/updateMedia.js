import logger from "#common-functions/logger/index.js";
import GetMultipleProducts from "#common-functions/shopify/getMultipleProductsWithid.js";
import Bundles from "#schemas/bundles.js";
import Stores from "#schemas/stores.js";

const UpdateMedia = async () => {
  logger("info", "Running CRON to update the product media.");
  try {
    const bundlesToProcess = await Bundles.find({
      isMediaSynced: false,
      isCreatedOnShopify: true,
    }).lean();
    const internalStore = await Stores.findOne({ isInternalStore: true });
    if (!bundlesToProcess) {
      logger("info", "No bundles found to process");
      return;
    }
    const bundleIds = bundlesToProcess.map((b) => b.shopifyProductId);
    const allShopifyProducts = await GetMultipleProducts({
      accessToken: internalStore.accessToken,
      productIds: bundleIds,
      shopName: internalStore.shopName,
    });

    const shopifyProductMap = {};
    allShopifyProducts.forEach((product) => {
      shopifyProductMap[product.id] = product;
    });
    await Promise.all(
      bundlesToProcess.map((bundle) => {
        const shopifyProduct = shopifyProductMap[bundle.shopifyProductId];
        if (shopifyProduct) {
          const { images } = shopifyProduct;
          const imageStrings = images.map((i) => i.src).filter(Boolean);
          const updateObj = {
            coverImage: imageStrings[0],
            images: imageStrings.slice(1),
            isMediaSynced: true,
          };
          return Bundles.findOneAndUpdate(bundle._id, updateObj);
        }
      })
    );

    logger("info", "Successfully updated the media for products");
  } catch (e) {
    logger("error", "[update-media] Error when updating the product media", e);
  }
};
setInterval(() => {
  UpdateMedia();
}, 24 * 60 * 60 * 1000); // run once a day.

export default UpdateMedia;
