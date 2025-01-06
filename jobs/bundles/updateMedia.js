import logger from "#common-functions/logger/index.js";
import Bundles from "#schemas/bundles.js";
import Stores from "#schemas/stores.js";
import executeShopifyQueries from "#common-functions/shopify/execute.js";
import { GET_MULTIPLE_PRODUCTS } from "#common-functions/shopify/queries.js";

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
    let allShopifyProducts;
    try {
      allShopifyProducts = await executeShopifyQueries({
        accessToken: internalStore.accessToken,
        storeUrl: internalStore.storeUrl,
        variables: {
          ids: bundleIds,
        },
        query: GET_MULTIPLE_PRODUCTS,

        callback: (result) => {
          const products = result?.data?.nodes;
          return products
            .map((product) => {
              if (!product) return null;
              return {
                images: product.images.edges.map(({ node }) => ({
                  src: node.src,
                  altText: node.altText || null,
                })),
              };
            })
            .filter(Boolean);
        },
      });
    } catch (e) {
      logger("error", "[update-media] Could not fetch multiple products");
    }

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
