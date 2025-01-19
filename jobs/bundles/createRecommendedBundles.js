import logger from "#common-functions/logger/index.js";
import Stores from "#schemas/stores.js";

import executeShopifyQueries from "#common-functions/shopify/execute.js";
import { GET_ORDERS } from "#common-functions/shopify/queries.js";
import Bundles from "#schemas/bundles.js";
import Products from "#schemas/products.js";
import { BUNDLE_CREATION_STATUSES } from "../../constants/bundle/index.js";
import Bundle from "#schemas/bundles.js";

const CreateRecommendedBundles = async () => {
  try {
    const storesWithoutBundle = await Stores.find({
      bundleCreation: BUNDLE_CREATION_STATUSES.PENDING,
      isActive: true,
      isProductsSynced: true,
      _id: "67811fac86daa35d05211df1",
    }).lean();

    if (storesWithoutBundle?.length) {
      const bundlePromises = await Promise.allSettled(
        storesWithoutBundle.map(async (store) => {
          try {
            let lastTenOrders;
            try {
              lastTenOrders = await executeShopifyQueries({
                accessToken: store.accessToken,
                callback: (result) => {
                  const formattedOrders = result?.data?.orders?.edges.map(
                    (orderEdge) => {
                      const order = orderEdge.node;
                      return {
                        orderId: order.id,
                        createdAt: order.createdAt,
                        totalPrice: order.totalPriceSet.presentmentMoney.amount,
                        currency:
                          order.totalPriceSet.presentmentMoney.currencyCode,
                        lineItems: order.lineItems.edges.map((lineItemEdge) => {
                          const lineItem = lineItemEdge.node;
                          return {
                            title: lineItem.title,
                            quantity: lineItem.quantity,
                            productId: lineItem.product.id,
                            price:
                              lineItem.originalUnitPriceSet.presentmentMoney
                                .amount,
                          };
                        }),
                      };
                    }
                  );
                  return formattedOrders;
                },
                query: GET_ORDERS,
                storeUrl: store.storeUrl,
              });
            } catch (e) {
              logger(
                "error",
                "[create-store-bundle] Could not fetch the orders of the product",
                e
              );
            }
            let counter = 0;
            const chunkedOrders = chunkArray(lastTenOrders);
            for (const chunk of chunkedOrders) {
              let bundleValue = 0;
              const bundleComponents = [];

              chunk.forEach((order) => {
                order.lineItems.forEach(async (lineItem) => {
                  const product = await Products.find({
                    productId: lineItem.id,
                  });
                  if (product) {
                    bundleValue += Number(lineItem.price);
                    bundleComponents.push({});
                  }
                });
              });
              const bundle = new Bundles({
                description: `This is an auto generated bundle. Please edit the Details and set the bundle as 'Active' to make it live on Giftclub!`,
                name: `Recommended bundle ${counter} For ${store.shopName}`,
                box: "",
                category: "",
                components: bundleComponents,
                status: "draft",
                store: store._id,
                price: bundleValue,
                tags: ["autogenerated"],
              });
              counter++;
            }
          } catch (error) {
            logger(
              "error",
              `Error creating bundle for store ${store.shopName}`,
              error
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

// export default () => {
//   // cron.schedule("0/10 * * * * *", async () => {
//   //   logger("info", "Running CreateBundles cron job...");
//   //   await CreateBundles();
//   });
// };
export default CreateRecommendedBundles;

function chunkArray(inputArray) {
  const chunks = [];
  let index = 0;

  while (index < inputArray.length) {
    // If there are exactly 3 items left, split as [2, 1]
    if (inputArray.length - index === 3) {
      chunks.push(inputArray.slice(index, index + 2)); // First chunk of 2
      chunks.push(inputArray.slice(index + 2, index + 3)); // Remaining chunk of 1
      break;
    }

    // Otherwise, create chunks of size 2
    chunks.push(inputArray.slice(index, index + 2));
    index += 2;
  }

  return chunks;
}
