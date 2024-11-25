import cron from "node-cron";
import logger from "../common-functions/logger/index.js";
import Stores from "#schemas/stores.js";

import GetStoreOrders from "#common-functions/shopify/getStoreOrders.service.js";
import Bundles from "#schemas/bundles.js";
import Products from "#schemas/products.js";
import { BUNDLE_CREATION_STATUSES } from "../constants/bundle/index.js";

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

            if (!lastTenOrders.success) {
              logger(
                "error",
                `Failed to fetch orders for store ${store.shopName}`
              );
              return;
            }

            const products = [];
            let totalPrice = 0;
            const allImages = [];

            lastTenOrders.data.forEach((order) => {
              order.products.forEach((product) => {
                products.push({
                  productId: product.productId,
                  title: product.title,
                  bodyHtml: product.bodyHtml,
                  createdAt: product.createdAt,
                  customProductType: product.customProductType,
                  description: product.description,
                  descriptionHtml: product.descriptionHtml,
                  descriptionPlainSummary: product.descriptionPlainSummary,
                  handle: product.handle,
                  isGiftCard: product.isGiftCard,
                  legacyResourceId: product.legacyResourceId,
                  onlineStoreUrl: product.onlineStoreUrl,
                  productType: product.productType,
                  tags: product.tags,
                  totalInventory: product.totalInventory,
                  totalVariants: product.totalVariants,
                  updatedAt: product.updatedAt,
                  vendor: product.vendor,
                  images: product.images,
                  originalUnitPrice: parseFloat(product.originalUnitPrice),
                  quantity: product.quantity,
                });
                if (product?.images?.length) {
                  product.images.forEach((img) => {
                    allImages.push(img.src);
                  });
                }
                // Calculate total price
                if (product.originalUnitPrice) {
                  totalPrice += product.originalUnitPrice * product.quantity;
                }
              });
            });

            if (products.length === 0) {
              logger(
                "warn",
                `No products found in orders for store ${store.shopName}`
              );
              return;
            }
            let coverImage = "";
            if (allImages.length) {
              coverImage = allImages[0];
            }

            const bundleObj = new Bundles({
              name: `Bundle for ${store.shopName}`,

              description: "Automatically generated bundle from recent orders.",
              store: store._id,
              price: totalPrice,
              status: "draft",
              tags: ["auto-generated", "internal-bundle"],
              metadata: {
                generatedBy: "Giftkart_internally",
                generatedAt: new Date(),
              },
              images: allImages,
              coverImage,
              costOfGoods: totalPrice,
            });

            const bundle = await bundleObj.save();

            products.map((product) => {
              product.bundle = bundle._id;
              return product;
            });

            await Products.insertMany(products);

            await Stores.updateOne(
              { _id: store._id },
              {
                $set: { bundleCreation: BUNDLE_CREATION_STATUSES.COMPLETED },
              }
            );

            logger(
              "info",
              `Bundle successfully created for store ${store.shopName}`
            );
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

export default () => {
  cron.schedule("0/10 * * * * *", async () => {
    logger("info", "Running CreateBundles cron job...");
    await CreateBundles();
  });
};
