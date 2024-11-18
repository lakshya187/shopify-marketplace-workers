import cron from "node-cron";
import logger from "../../common-functions/logger/index.js";
import Stores from "#schemas/stores.js";
import { BUNDLE_CREATION_STATUSES } from "./enums.js";
import GetStoreOrders from "#common-functions/shopify/getStoreOrders.service.js";
import Bundles from "#schemas/bundles.js";

const CreateBundles = async () => {
  try {
    const storesWithoutBundle = await Stores.find({
      bundleCreation: BUNDLE_CREATION_STATUSES.PENDING,
    }).lean();

    if (storesWithoutBundle?.length) {
      // Using Promise.allSettled to process all stores
      const bundlePromises = await Promise.allSettled(
        storesWithoutBundle.map(async (store) => {
          try {
            const lastTenOrders = await GetStoreOrders({
              shopUrl: store.storeUrl,
              accessToken: store.accessToken,
              numOfOrders: 10,
            });

            // Check if fetching orders was successful
            if (!lastTenOrders.success) {
              logger(
                "error",
                `Failed to fetch orders for store ${store.shopName}`
              );
              return;
            }

            const productIds = [];
            let totalPrice = 0;

            lastTenOrders.data.forEach((order) => {
              order.lineItems.forEach((lineItem) => {
                productIds.push(lineItem.id); // Extract product IDs
                if (lineItem.unitPrice) {
                  totalPrice +=
                    parseFloat(lineItem.unitPrice) * lineItem.quantity; // Calculate total price
                }
              });
            });

            if (productIds.length === 0) {
              logger(
                "warn",
                `No products found in orders for store ${store.shopName}`
              );
              return;
            }

            // Create a bundle document
            const bundleObj = new Bundles({
              name: `Bundle for ${store.shopName}`,
              description: "Automatically generated bundle from recent orders.",
              product_ids: productIds,
              store: store._id,
              price: totalPrice,
              status: "draft",
              tags: ["auto-generated", "internal-bundle"],
              metadata: {
                generatedBy: "Giftkart_internally",
                generatedAt: new Date(),
              },
            });

            // Save to the database
            await bundleObj.save();

            await Stores.updateOne(
              { _id: store._id },
              {
                $set: { bundleCreation: BUNDLE_CREATION_STATUSES.COMPLETED },
              }
            );

            logger(
              "info",
              `Bundle created successfully for store ${store.shopName}`
            );
          } catch (error) {
            console.log(error);

            logger(
              "error",
              `Error processing bundle for store ${store.shopName}: ${error.message}`
            );
          }
        })
      );

      // Log any failed operations for further analysis
      const failedPromises = bundlePromises.filter(
        (p) => p.status === "rejected"
      );
      if (failedPromises.length > 0) {
        logger(
          "error",
          `${failedPromises.length} bundle creation operations failed.`,
          failedPromises
        );
      }

      logger("info", "Completed processing bundles for pending stores.");
    }
  } catch (err) {
    logger("error", `Error in CreateBundles: ${err.message}`);
  }
};

// Cron job that runs every minute

export default () => {
  cron.schedule("0/10 * * * * *", async () => {
    logger("info", "Running CreateBundles cron job...");
    await CreateBundles();
  });
};
// Export the cron job initialization (optional)
