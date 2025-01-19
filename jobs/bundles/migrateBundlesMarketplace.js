// dont remove the unused imports
import Bundle from "#schemas/bundles.js";
import logger from "#common-functions/logger/index.js";
import Stores from "#schemas/stores.js";
import {
  BUNDLE_PACKAGING_NAMESPACE,
  BUNDLE_PACKAGING_VARIANT,
  BUNDLE_STATUSES,
  BUNDLE_WITHOUT_PACKAGING_VARIANT,
} from "../../constants/bundle/index.js";
import StoreDetails from "#schemas/storeDetails.js";
import categories from "#schemas/categories.js";
import box from "#schemas/boxes.js";
import products from "#schemas/products.js";
import executeShopifyQueries from "#common-functions/shopify/execute.js";
import {
  CREATE_PRODUCT_WITH_MEDIA,
  GET_PRODUCT_DETAILS,
  GET_PRODUCT_VARIANTS_INVENTORY,
  GET_STORE_LOCATION,
  INVENTORY_ADJUST_QUANTITIES,
  PRODUCT_VARIANT_BULK_UPDATE,
  PRODUCT_VARIANTS_CREATE,
} from "#common-functions/shopify/queries.js";
import StoreBoxes from "#schemas/storeBoxes.js";

const processingTemp = {};

const MigrateBundlesToShopify = async () => {
  try {
    const activeBundles = await Bundle.find({
      status: BUNDLE_STATUSES.ACTIVE,
      isCreatedOnShopify: false,
    })
      .populate("store")
      .populate("category")
      .populate("box")
      .populate({ path: "components.product" })
      .lean();

    if (!activeBundles.length) {
      logger("info", "No active bundles to process.");
      return;
    }

    logger("info", `Found ${activeBundles.length} active bundles to process.`);
    const internalStores = await Stores.find({ isInternalStore: true }).lean();
    logger("info", `Found ${internalStores.length} stores found to process.`);

    if (internalStores.length) {
      await Promise.all(
        internalStores.map(async (store) => {
          const promises = activeBundles.map(async (bundle) => {
            try {
              if (!processingTemp[bundle._id]) {
                processingTemp[bundle._id] = true;
              } else {
                logger("error", "Already processing the bundle");
                return;
              }
              const [storeDetails] = await StoreDetails.find({
                store: bundle.store._id,
              }).lean();
              const storeInventory = await StoreBoxes.findOne({
                store: bundle.store._id,
              }).lean();
              const { components: products } = bundle;
              if (products.length) {
                const internalProduct = await CreateStoreProduct({
                  bundle,
                  accessToken: store.accessToken,
                  shopName: store.shopName,
                  products,
                  isInternal: true,
                  storeUrl: store.storeUrl,
                  storeLogo: storeDetails?.logo ?? "",
                  storeInventory: storeInventory?.inventory,
                });
                const vendorProduct = await CreateStoreProduct({
                  bundle,
                  accessToken: bundle.store.accessToken,
                  shopName: bundle.store.shopName,
                  products,
                  isInternal: false,
                  storeUrl: bundle.store.storeUrl,
                  storeLogo: storeDetails?.logo ?? "",
                  isVendorProduct: true,
                  storeInventory: storeInventory?.inventory,
                });

                const variantMapping = {};
                internalProduct.variantMapping.forEach((mVariant) => {
                  const vendorVariant = vendorProduct.variantMapping.find(
                    (vVariant) => vVariant.title === mVariant.title
                  );
                  if (vendorVariant) {
                    variantMapping[mVariant.id] = vendorVariant;
                  }
                });

                const productMetaData = {
                  ...store.metadata,
                  vendorShopifyId: vendorProduct.product.id,
                  variantMapping,
                };

                await Bundle.findByIdAndUpdate(bundle._id, {
                  isCreatedOnShopify: true,
                  shopifyProductId: internalProduct.product.id,
                  metadata: productMetaData,
                  handle: internalProduct.product.handle,
                });
                delete processingTemp[bundle._id];
              }
              logger(
                "info",
                `Successfully created the bundle on both merchant and marketplace.`
              );
            } catch (err) {
              delete processingTemp[bundle._id];
              logger(
                "error",
                `Failed to create product bundle for ${bundle._id}`,
                err
              );
            }
          });

          await Promise.all(promises);
        })
      );
    }
  } catch (err) {
    logger("error", "Error processing bundles", err);
  }
};

setInterval(() => {
  // MigrateBundlesToShopify();
}, process.env.MIGRATE_BUNDLE_WORKER_INTERVAL_MS);

// utils

export default MigrateBundlesToShopify;

// module specific functions
const CreateStoreProduct = async ({
  bundle,
  accessToken,
  products,
  storeLogo,
  storeUrl,
  isVendorProduct,
  storeInventory,
}) => {
  // creating the product
  const media = [];
  if (bundle.coverImage) {
    media.push({
      mediaContentType: "IMAGE",
      originalSource: bundle.coverImage.url,
      alt: `Cover image for ${bundle.name}`,
    });
  }
  if (bundle.images && bundle.images.length > 0) {
    bundle.images.forEach((imageUrl, index) => {
      media.push({
        mediaContentType: "IMAGE",
        originalSource: imageUrl.url,
        alt: `Additional image ${index + 1} for ${bundle.name}`,
      });
    });
  }
  const box = {};
  if (bundle.box) {
    box["price"] = bundle.box.price;
    box["size"] = bundle.box.sizes.size;
  }
  const category = {};
  if (bundle?.category?.category?.id) {
    category["category"] = bundle.category.category.id;
  }
  const variables = {
    input: {
      title: bundle.name,
      descriptionHtml: bundle.description || "Bundle created from application.",
      tags: bundle.tags || [],
      vendor: bundle.vendor ?? "",
      status: isVendorProduct ? "DRAFT" : "ACTIVE",
      ...category,
      productOptions: [
        {
          name: BUNDLE_PACKAGING_NAMESPACE,
          values: [
            {
              name: BUNDLE_WITHOUT_PACKAGING_VARIANT,
            },
          ],
        },
      ],
      metafields: [
        {
          namespace: "custom",
          key: "bundle_components",
          value: JSON.stringify({
            products,
            box: {
              ...box,
            },
            storeLogo,
          }),
          type: "json_string",
        },
      ],
    },
    media: media,
  };
  let product;
  try {
    product = await executeShopifyQueries({
      query: CREATE_PRODUCT_WITH_MEDIA,
      accessToken,
      callback: (result) => {
        return result.data?.productCreate?.product;
      },
      storeUrl,
      variables,
    });
    logger("info", "Successfully created the product on the store");
  } catch (e) {
    logger(
      "error",
      `[migrate-bundles-marketplace[create-store-product]] Could not create store product`,
      e
    );
    throw new Error(e);
  }
  // updating the default variant
  let inventoryPolicy = "";
  if (bundle.trackInventory) {
    inventoryPolicy = "DENY";
  } else {
    inventoryPolicy = "CONTINUE";
  }
  const isPackagingAvailable =
    bundle.box &&
    storeInventory.find(
      (inventory) => inventory.box.toString() === bundle.box._id.toString()
    );

  if (isPackagingAvailable && isPackagingAvailable.remaining) {
    try {
      await executeShopifyQueries({
        accessToken,
        query: PRODUCT_VARIANTS_CREATE,
        storeUrl,
        variables: {
          productId: product.id,
          variants: [
            {
              optionValues: [
                {
                  name: BUNDLE_PACKAGING_VARIANT,
                  optionName: BUNDLE_PACKAGING_NAMESPACE,
                },
              ],
            },
          ],
        },
      });
    } catch (e) {
      logger(
        "error",
        `[migrate-bundles-marketplace[create-store-product]] Could add the product packaging option`,
        e
      );
      return;
    }
  }

  let variants;
  let variantIds = [];
  const variantMapping = [];
  let packagingVariantId = "";
  try {
    variants = await executeShopifyQueries({
      accessToken,
      query: GET_PRODUCT_DETAILS,
      storeUrl,
      variables: {
        id: product.id,
      },
      callback: (result) => {
        const product = result?.data?.product;
        return {
          variants: product.variants.edges.map(({ node }) => {
            const isPackaging = node.title === BUNDLE_PACKAGING_VARIANT;

            variantIds.push(node.id);
            variantMapping.push({
              id: node.id,
              title: node.title,
            });

            if (isPackaging) {
              packagingVariantId = node.id;
            }
            return {
              id: node.id,
              compareAtPrice: isPackaging
                ? Number(bundle.compareAtPrice) + (bundle.box?.price ?? 0)
                : bundle.compareAtPrice,
              price: isPackaging
                ? bundle.price + (bundle.box?.price ?? 0)
                : bundle.price,

              inventoryItem: {
                tracked: bundle.trackInventory,
                sku: isPackaging ? `${bundle.sku}_P` : bundle.sku,
              },
              inventoryPolicy,
            };
          }),
        };
      },
    });
    logger("info", "Successfully fetched the product variants");
  } catch (e) {
    logger(
      "error",
      `[migrate-bundles-marketplace[create-store-product]] Could fetch the product variants`,
      e
    );
    return;
  }

  try {
    await executeShopifyQueries({
      accessToken,
      callback: null,
      query: PRODUCT_VARIANT_BULK_UPDATE,
      storeUrl,
      variables: {
        productId: product.id,
        ...variants,
      },
    });
    logger("info", "Successfully updated then product variant");
  } catch (e) {
    logger(
      "error",
      `[migrate-bundles-marketplace[create-store-product]] Could update the product's default variant`,
      e
    );
    throw new Error(e);
  }

  // fetch the store location id
  let locations = [];
  let location;
  try {
    locations = await executeShopifyQueries({
      query: GET_STORE_LOCATION,
      accessToken,
      callback: (result) => result.data.locations.edges,
      storeUrl,
      variables: null,
    });
    logger("info", "Successfully fetched the store locations");
  } catch (e) {
    logger(
      "error",
      `[migrate-bundles-marketplace[create-store-product]] Could not get the location of the store`,
      e
    );
    throw new Error(e);
  }
  if (locations.length) {
    const defaultLocation = locations.find(
      (l) => l.node.name === "Shop location"
    );
    if (!defaultLocation) {
      location = locations[0].node.id;
    } else {
      location = defaultLocation.node.id;
    }
  }
  //updating the inventory

  const variantInventoryVariables = {
    variantIds,
  };
  let inventoryUpdateObjs;
  try {
    inventoryUpdateObjs = await executeShopifyQueries({
      accessToken,
      callback: (result) => {
        return result?.data?.nodes.map((obj) => {
          const isPackaging = obj.id === packagingVariantId;
          return {
            delta: isPackaging
              ? Math.min(isPackagingAvailable.remaining, bundle.inventory)
              : bundle.inventory,
            inventoryItemId: obj.inventoryItem.id,
            locationId: location,
          };
        });
      },
      query: GET_PRODUCT_VARIANTS_INVENTORY,
      storeUrl,
      variables: variantInventoryVariables,
    });
    logger("info", "Successfully fetched the inventory for the variants");
  } catch (e) {
    logger(
      "error",
      `[migrate-bundles-marketplace[create-store-product]] Could not get the  default variant inventory id`,
      e
    );
    throw new Error(e);
  }

  try {
    const inventoryAdjustQuantitiesVariables = {
      input: {
        reason: "correction",
        name: "available",
        changes: inventoryUpdateObjs,
      },
    };

    await executeShopifyQueries({
      accessToken,
      callback: null,
      query: INVENTORY_ADJUST_QUANTITIES,
      storeUrl,
      variables: inventoryAdjustQuantitiesVariables,
    });
    logger("info", "Successfully updated inventory for the default variant");
  } catch (e) {
    logger(
      "error",
      `[migrate-bundles-marketplace[create-store-product]] Could adjust the inventory quantities`,
      e
    );
    throw new Error(e);
  }

  return { product, variantMapping };
};
