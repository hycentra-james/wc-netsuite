/*
 * shippingWeightDimension.js
 * Shared library for calculating shipping weight and dimensions
 * Used by both FedEx and UPS integrations
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */

define(['N/record', 'N/search', 'N/error', 'N/log'],
    function (record, search, error, log) {
        
        const MAX_RECURSION_DEPTH = 3;
        
        /**
         * Calculate weight and dimensions for a Sales Order
         * Returns packages array with individual box dimensions and aggregated totals
         *
         * @param {record} salesOrderRecord The Sales Order record
         * @returns {Object} { packages: [{weight, dimensions}], totalWeight, totalPackageCount }
         */
        function calculateSalesOrderWeightAndDimensions(salesOrderRecord) {
            try {
                log.debug('Weight/Dimension Calculation', 'Starting calculation for Sales Order: ' + salesOrderRecord.id);
                
                var allPackages = [];
                var lineCount = salesOrderRecord.getLineCount({ sublistId: 'item' });
                
                if (lineCount === 0) {
                    log.debug('Weight/Dimension Warning', 'Sales Order has no line items');
                    return {
                        packages: [],
                        totalWeight: 0,
                        totalPackageCount: 0
                    };
                }
                
                // Process each line item
                for (var i = 0; i < lineCount; i++) {
                    var itemId = salesOrderRecord.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'item',
                        line: i
                    });
                    
                    var quantity = salesOrderRecord.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'quantity',
                        line: i
                    });
                    
                    if (!itemId || !quantity) {
                        log.debug('Weight/Dimension Warning', 'Skipping line ' + i + ' - missing item or quantity');
                        continue;
                    }
                    
                    // Determine item type
                    var itemType = getItemType(itemId);
                    
                    log.debug('Weight/Dimension Item', 'Processing line ' + i + ': Item=' + itemId + ', Type=' + itemType + ', Qty=' + quantity);
                    
                    // Get weight/dimensions for this line item
                    var linePackages = getBoxWeightAndDimensions(itemId, itemType, quantity, 0);
                    
                    // Multiply packages by quantity
                    for (var q = 0; q < quantity; q++) {
                        for (var p = 0; p < linePackages.packages.length; p++) {
                            allPackages.push({
                                weight: linePackages.packages[p].weight,
                                dimensions: linePackages.packages[p].dimensions
                            });
                        }
                    }
                }
                
                // Calculate totals
                var totalWeight = 0;
                for (var j = 0; j < allPackages.length; j++) {
                    totalWeight += allPackages[j].weight;
                }
                
                // Apply minimum weight of 1 lb per package
                for (var k = 0; k < allPackages.length; k++) {
                    if (allPackages[k].weight < 1) {
                        allPackages[k].weight = 1;
                        totalWeight = totalWeight - allPackages[k].weight + 1;
                    }
                }
                
                var result = {
                    packages: allPackages,
                    totalWeight: totalWeight,
                    totalPackageCount: allPackages.length
                };
                
                log.debug('Weight/Dimension Result', 'Total packages: ' + result.totalPackageCount + ', Total weight: ' + result.totalWeight + ' lbs');
                
                return result;
                
            } catch (e) {
                log.error({
                    title: 'Weight/Dimension Calculation Error',
                    details: 'Error calculating weight/dimensions: ' + e.message + '\nStack: ' + e.stack
                });
                throw e;
            }
        }
        
        /**
         * Get weight and dimensions for a single item (Inventory or Kit)
         *
         * @param {string|number} itemId The item internal ID
         * @param {string} itemType The item type ('InvtPart' or 'Kit')
         * @param {number} quantity The quantity of the item
         * @param {number} depth Current recursion depth (for kits)
         * @returns {Object} { packages: [{weight, dimensions}], totalWeight, totalPackageCount }
         */
        function getBoxWeightAndDimensions(itemId, itemType, quantity, depth) {
            if (depth > MAX_RECURSION_DEPTH) {
                throw error.create({
                    name: 'KIT_RECURSION_DEPTH_EXCEEDED',
                    message: 'Kit nesting depth exceeded maximum of ' + MAX_RECURSION_DEPTH + ' levels. Item: ' + itemId
                });
            }
            
            if (itemType === 'InvtPart' || itemType === 'Inventory Item') {
                return getItemWeightAndDimensions(itemId, quantity);
            } else if (itemType === 'Kit') {
                return getKitWeightAndDimensions(itemId, quantity, depth);
            } else {
                log.debug('Weight/Dimension Warning', 'Unknown item type: ' + itemType + ' for item ' + itemId);
                // Return default package
                return {
                    packages: [{
                        weight: 1,
                        dimensions: { length: 1, width: 1, height: 1 }
                    }],
                    totalWeight: 1,
                    totalPackageCount: 1
                };
            }
        }
        
        /**
         * Get weight and dimensions for an Inventory Item
         *
         * @param {string|number} itemId The inventory item internal ID
         * @param {number} quantity The quantity
         * @returns {Object} { packages: [{weight, dimensions}], totalWeight, totalPackageCount }
         */
        function getItemWeightAndDimensions(itemId, quantity) {
            try {
                log.debug('Inventory Item Weight/Dimension', 'Getting weight/dimensions for item: ' + itemId);
                
                // Load inventory item record
                var itemRecord = record.load({
                    type: record.Type.INVENTORY_ITEM,
                    id: itemId
                });
                
                // Get weight and dimensions
                var weight = parseFloat(itemRecord.getValue({ fieldId: 'custitem_fmt_shipping_weight' })) || 1;
                var width = parseFloat(itemRecord.getValue({ fieldId: 'custitem_fmt_shipping_width' })) || 1;
                var length = parseFloat(itemRecord.getValue({ fieldId: 'custitem_fmt_shipping_length' })) || 1;
                var height = parseFloat(itemRecord.getValue({ fieldId: 'custitem_fmt_shipping_height' })) || 1;
                
                // Apply minimums
                if (weight < 1) weight = 1;
                if (width < 1) width = 1;
                if (length < 1) length = 1;
                if (height < 1) height = 1;
                
                log.debug('Inventory Item Weight/Dimension', 'Item ' + itemId + ': Weight=' + weight + ' lbs, Dimensions=' + length + 'x' + width + 'x' + height);
                
                // Inventory items always have 1 box
                return {
                    packages: [{
                        weight: weight,
                        dimensions: {
                            length: length,
                            width: width,
                            height: height
                        }
                    }],
                    totalWeight: weight,
                    totalPackageCount: 1
                };
                
            } catch (e) {
                log.error({
                    title: 'Inventory Item Weight/Dimension Error',
                    details: 'Error getting weight/dimensions for item ' + itemId + ': ' + e.message
                });
                // Return default package
                return {
                    packages: [{
                        weight: 1,
                        dimensions: { length: 1, width: 1, height: 1 }
                    }],
                    totalWeight: 1,
                    totalPackageCount: 1
                };
            }
        }
        
        /**
         * Get weight and dimensions for a Kit Item (recursive)
         *
         * @param {string|number} kitId The kit item internal ID
         * @param {number} quantity The quantity of kits
         * @param {number} depth Current recursion depth
         * @returns {Object} { packages: [{weight, dimensions}], totalWeight, totalPackageCount }
         */
        function getKitWeightAndDimensions(kitId, quantity, depth) {
            try {
                log.debug('Kit Weight/Dimension', 'Getting weight/dimensions for kit: ' + kitId + ' (depth: ' + depth + ')');
                
                // Load kit record
                var kitRecord = record.load({
                    type: record.Type.KIT_ITEM,
                    id: kitId
                });
                
                // Get number of boxes
                var numberOfBoxes = parseInt(kitRecord.getValue({ fieldId: 'custitem_fmt_no_boxes' })) || 1;
                
                if (numberOfBoxes < 1) {
                    numberOfBoxes = 1;
                }
                
                log.debug('Kit Weight/Dimension', 'Kit ' + kitId + ' has ' + numberOfBoxes + ' boxes');
                
                var allPackages = [];
                
                // Process each box
                for (var boxNum = 1; boxNum <= numberOfBoxes; boxNum++) {
                    var cartonSkuFieldId = 'custitem_wc_carton_sku_' + boxNum;
                    var cartonSkuId = kitRecord.getValue({ fieldId: cartonSkuFieldId });
                    
                    if (!cartonSkuId) {
                        throw error.create({
                            name: 'MISSING_CARTON_SKU',
                            message: 'Kit item ' + kitId + ' is missing carton SKU for box ' + boxNum + 
                                     '. Please configure ' + cartonSkuFieldId + ' field.'
                        });
                    }
                    
                    log.debug('Kit Weight/Dimension', 'Processing box ' + boxNum + ' with carton SKU: ' + cartonSkuId);
                    
                    // Get weight/dimensions for this carton SKU (recursive)
                    var cartonPackages = getCartonSkuWeightAndDimensions(cartonSkuId, depth + 1);
                    
                    // Add all packages from this carton SKU
                    for (var p = 0; p < cartonPackages.packages.length; p++) {
                        allPackages.push({
                            weight: cartonPackages.packages[p].weight,
                            dimensions: cartonPackages.packages[p].dimensions
                        });
                    }
                }
                
                // Calculate totals
                var totalWeight = 0;
                for (var i = 0; i < allPackages.length; i++) {
                    totalWeight += allPackages[i].weight;
                }
                
                log.debug('Kit Weight/Dimension', 'Kit ' + kitId + ' total: ' + allPackages.length + ' packages, ' + totalWeight + ' lbs');
                
                return {
                    packages: allPackages,
                    totalWeight: totalWeight,
                    totalPackageCount: allPackages.length
                };
                
            } catch (e) {
                log.error({
                    title: 'Kit Weight/Dimension Error',
                    details: 'Error getting weight/dimensions for kit ' + kitId + ': ' + e.message
                });
                throw e;
            }
        }
        
        /**
         * Get weight and dimensions for a carton SKU (could be Inventory Item or Kit)
         *
         * @param {string|number} cartonSkuId The carton SKU internal ID
         * @param {number} depth Current recursion depth
         * @returns {Object} { packages: [{weight, dimensions}], totalWeight, totalPackageCount }
         */
        function getCartonSkuWeightAndDimensions(cartonSkuId, depth) {
            try {
                log.debug('Carton SKU Weight/Dimension', 'Processing carton SKU: ' + cartonSkuId + ' (depth: ' + depth + ')');
                
                // Determine item type
                var itemType = getItemType(cartonSkuId);
                
                // Get weight/dimensions (recursive if it's a kit)
                return getBoxWeightAndDimensions(cartonSkuId, itemType, 1, depth);
                
            } catch (e) {
                log.error({
                    title: 'Carton SKU Weight/Dimension Error',
                    details: 'Error processing carton SKU ' + cartonSkuId + ': ' + e.message
                });
                throw e;
            }
        }
        
        /**
         * Get item type (Inventory Item or Kit)
         *
         * @param {string|number} itemId The item internal ID
         * @returns {string} 'InvtPart' or 'Kit'
         */
        function getItemType(itemId) {
            try {
                // Try to load as inventory item first
                try {
                    var invtRecord = record.load({
                        type: record.Type.INVENTORY_ITEM,
                        id: itemId
                    });
                    return 'InvtPart';
                } catch (e) {
                    // Not an inventory item, try kit
                    try {
                        var kitRecord = record.load({
                            type: record.Type.KIT_ITEM,
                            id: itemId
                        });
                        return 'Kit';
                    } catch (e2) {
                        log.error('Item Type Error', 'Could not determine type for item ' + itemId);
                        return 'InvtPart'; // Default
                    }
                }
            } catch (e) {
                log.error({
                    title: 'Item Type Error',
                    details: 'Error determining item type for ' + itemId + ': ' + e.message
                });
                return 'InvtPart'; // Default
            }
        }
        
        return {
            calculateSalesOrderWeightAndDimensions: calculateSalesOrderWeightAndDimensions,
            getItemWeightAndDimensions: getItemWeightAndDimensions,
            getKitWeightAndDimensions: getKitWeightAndDimensions,
            getBoxWeightAndDimensions: getBoxWeightAndDimensions,
            getCartonSkuWeightAndDimensions: getCartonSkuWeightAndDimensions
        };
    }
);

