/**
 * kitCartonResolver.js
 * Shared module for resolving shipping carton weight & dimensions from the
 * sold Kit's carton layout instead of the packed inventory items.
 *
 * Background (WC-648):
 * Water Creation sells combination/kit items (e.g. EB30B-0100, MI18CR01ES-000NH0101).
 * NetSuite WMS/ShipCentral only packs INVENTORY items, so an Item Fulfillment and its
 * PackShip carton records reference the exploded component inventory items, NOT the kit.
 * The correct shipping dimensions live on the sold Kit's carton layout:
 *
 *   custitem_fmt_no_boxes       - number of physical boxes (N)
 *   custitem_wc_carton_sku_1..N - the item defining each box's content + dimensions
 *
 * Each "carton SKU" carries its own custitem_fmt_shipping_length/width/height/weight.
 * A carton SKU may be an inventory item (packed as itself) or a Kit (packed as its
 * member inventory items). This module resolves the sold kit(s) on an Item Fulfillment
 * into a list of "box definitions", then matches each physical PackShip carton to a
 * box definition by content so the label gets the true box dimensions.
 *
 * Per WC-648 decisions (weight precedence updated per approved follow-up, 2026-07-17):
 *  1. Weight: the Item/Kit record data is authoritative whenever the matching kit box can
 *     be found - PREFER the carton SKU's own custitem_fmt_shipping_weight (NOT summed
 *     component weight) over the vendor/scale-reported actual carton weight. Actual scanned
 *     weight is only used as a fallback when the matched carton SKU has no weight populated,
 *     or when the carton could not be matched to any kit box at all (non-kit cartons).
 *  2. If a kit-derived carton cannot be uniquely matched to a box definition, HARD FAIL
 *     (throw) so the label is not printed with wrong dimensions.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/search', 'N/error', 'N/log'], function (record, search, error, log) {

    var NO_BOXES_FIELD = 'custitem_fmt_no_boxes';
    var CARTON_SKU_PREFIX = 'custitem_wc_carton_sku_';
    var DIM_LENGTH = 'custitem_fmt_shipping_length';
    var DIM_WIDTH = 'custitem_fmt_shipping_width';
    var DIM_HEIGHT = 'custitem_fmt_shipping_height';
    var SHIP_WEIGHT = 'custitem_fmt_shipping_weight';
    var MAX_CARTON_SKUS = 20; // safety cap when iterating carton_sku_N fields

    // Item record types to try when loading an item of unknown type
    var ITEM_LOAD_TYPES = [
        'inventoryitem',
        'kititem',
        'assemblyitem',
        'noninventoryitem',
        'nonInventoryResaleItem',
        'otherchargeitem',
        'serviceitem'
    ];

    /* ------------------------------------------------------------------ *
     * PURE LOGIC (no NetSuite dependencies) - unit testable
     * ------------------------------------------------------------------ */

    function toIdSet(ids) {
        var set = {};
        for (var i = 0; i < ids.length; i++) {
            set[String(ids[i])] = true;
        }
        return set;
    }

    function isSubset(items, setObj) {
        for (var i = 0; i < items.length; i++) {
            if (!setObj[String(items[i])]) {
                return false;
            }
        }
        return true;
    }

    function dimsWeightEqual(a, b) {
        return a.dims.length === b.dims.length &&
            a.dims.width === b.dims.width &&
            a.dims.height === b.dims.height &&
            a.weight === b.weight;
    }

    /**
     * Match a physical carton's packed inventory items to a box definition.
     *
     * @param {Array<string|number>} cartonItemIds - distinct inventory item ids in the carton
     * @param {Array<Object>} boxDefs - [{ cartonSkuId, dims:{length,width,height}, weight, invItemSet:[] }]
     * @param {Object} kitMemberSet - set (map id->true) of all inventory ids belonging to any sold kit
     * @param {string} cartonId - carton name, for logging / error context
     * @returns {Object|null} { dims:{length,width,height}, weight, cartonSkuId } when matched to a kit box;
     *                        null when the carton is not kit-derived (caller uses legacy per-item logic)
     * @throws when the carton is kit-derived but cannot be uniquely resolved (hard fail)
     */
    function resolveCartonBox(cartonItemIds, boxDefs, kitMemberSet, cartonId) {
        if (!cartonItemIds || cartonItemIds.length === 0) {
            return null; // nothing packed - let legacy logic / minimums apply
        }

        var matches = [];
        for (var i = 0; i < boxDefs.length; i++) {
            if (isSubset(cartonItemIds, toIdSet(boxDefs[i].invItemSet))) {
                matches.push(boxDefs[i]);
            }
        }

        if (matches.length === 1) {
            return pickBox(matches[0]);
        }

        if (matches.length > 1) {
            // Multiple box defs contain these items. Tolerate only if they are
            // dimensionally identical (e.g. duplicate box types); otherwise ambiguous.
            var allEqual = true;
            for (var m = 1; m < matches.length; m++) {
                if (!dimsWeightEqual(matches[0], matches[m])) {
                    allEqual = false;
                    break;
                }
            }
            if (allEqual) {
                return pickBox(matches[0]);
            }
            throw error.create({
                name: 'KIT_CARTON_AMBIGUOUS',
                message: 'Carton "' + cartonId + '" packed items [' + cartonItemIds.join(', ') +
                    '] match multiple kit box definitions with differing dimensions. ' +
                    'Cannot determine shipping dimensions - correct the kit carton SKU setup.'
            });
        }

        // No box def contains all of the carton's items.
        var kitRelated = false;
        for (var k = 0; k < cartonItemIds.length; k++) {
            if (kitMemberSet[String(cartonItemIds[k])]) {
                kitRelated = true;
                break;
            }
        }
        if (kitRelated) {
            throw error.create({
                name: 'KIT_CARTON_UNRESOLVED',
                message: 'Carton "' + cartonId + '" contains kit component items [' + cartonItemIds.join(', ') +
                    '] that do not match any single box definition of the sold kit(s). ' +
                    'Packed contents do not align with the kit carton layout - cannot determine shipping dimensions.'
            });
        }

        // Not kit-derived (e.g. plain inventory item order) -> caller uses legacy logic.
        return null;
    }

    function pickBox(boxDef) {
        return {
            dims: {
                length: boxDef.dims.length,
                width: boxDef.dims.width,
                height: boxDef.dims.height
            },
            weight: boxDef.weight,
            cartonSkuId: boxDef.cartonSkuId
        };
    }

    /* ------------------------------------------------------------------ *
     * NETSUITE DATA ACCESS
     * ------------------------------------------------------------------ */

    /**
     * Load an item of unknown type. Returns { rec, type } or null.
     */
    function loadItemAnyType(itemId) {
        for (var t = 0; t < ITEM_LOAD_TYPES.length; t++) {
            try {
                var rec = record.load({ type: ITEM_LOAD_TYPES[t], id: itemId });
                return { rec: rec, type: ITEM_LOAD_TYPES[t] };
            } catch (e) {
                // try next type
            }
        }
        return null;
    }

    /**
     * Read the member (component) inventory item ids of a kit item record.
     */
    function getKitMemberItemIds(kitRec) {
        var ids = [];
        var lineCount = kitRec.getLineCount({ sublistId: 'member' });
        for (var i = 0; i < lineCount; i++) {
            var memberId = kitRec.getSublistValue({ sublistId: 'member', fieldId: 'item', line: i });
            if (memberId && ids.indexOf(String(memberId)) === -1) {
                ids.push(String(memberId));
            }
        }
        return ids;
    }

    function parseDim(value) {
        return parseFloat(value) || 0;
    }

    /**
     * Build a single box definition from a carton SKU item.
     * @throws when the carton SKU has no usable dimensions (hard fail).
     */
    function buildBoxDefFromCartonSku(cartonSkuId, sourceKitId) {
        var loaded = loadItemAnyType(cartonSkuId);
        if (!loaded) {
            throw error.create({
                name: 'CARTON_SKU_LOAD_FAILED',
                message: 'Kit ' + sourceKitId + ' references carton SKU item ' + cartonSkuId +
                    ' which could not be loaded. Cannot determine shipping dimensions.'
            });
        }

        var rec = loaded.rec;
        var dims = {
            length: parseDim(rec.getValue({ fieldId: DIM_LENGTH })),
            width: parseDim(rec.getValue({ fieldId: DIM_WIDTH })),
            height: parseDim(rec.getValue({ fieldId: DIM_HEIGHT }))
        };
        var weight = parseDim(rec.getValue({ fieldId: SHIP_WEIGHT }));

        if (dims.length <= 0 || dims.width <= 0 || dims.height <= 0) {
            throw error.create({
                name: 'CARTON_SKU_MISSING_DIMS',
                message: 'Carton SKU ' + cartonSkuId + ' (box of kit ' + sourceKitId + ') is missing shipping ' +
                    'dimensions (' + dims.length + 'x' + dims.width + 'x' + dims.height + '). ' +
                    'Populate custitem_fmt_shipping_length/width/height before shipping.'
            });
        }

        // Resolve the inventory items that WMS will pack for this box.
        var invItemSet;
        if (loaded.type === 'kititem') {
            invItemSet = getKitMemberItemIds(rec);
        } else {
            invItemSet = [String(cartonSkuId)];
        }

        return {
            cartonSkuId: String(cartonSkuId),
            dims: dims,
            weight: weight,
            invItemSet: invItemSet
        };
    }

    /**
     * Find the internal ids of the sold Kit line items on an Item Fulfillment.
     */
    function getSoldKitItemIds(fulfillmentId) {
        var kitIds = [];
        var ffSearch = search.create({
            type: search.Type.ITEM_FULFILLMENT,
            filters: [
                ['internalid', 'anyof', fulfillmentId], 'and',
                ['item.type', 'anyof', 'Kit']
            ],
            columns: [
                search.createColumn({ name: 'item', summary: search.Summary.GROUP })
            ]
        });

        ffSearch.run().each(function (result) {
            var itemId = result.getValue({ name: 'item', summary: search.Summary.GROUP });
            if (itemId && kitIds.indexOf(String(itemId)) === -1) {
                kitIds.push(String(itemId));
            }
            return true;
        });

        return kitIds;
    }

    /**
     * Build all box definitions for the sold kit(s) on an Item Fulfillment.
     *
     * @param {string|number} fulfillmentId
     * @returns {Object} { boxDefs: [...], kitMemberSet: {id->true}, kitCount: n }
     */
    function buildKitBoxDefs(fulfillmentId) {
        var kitIds = getSoldKitItemIds(fulfillmentId);
        var boxDefs = [];
        var kitMemberSet = {};

        for (var i = 0; i < kitIds.length; i++) {
            var kitId = kitIds[i];
            var loaded = loadItemAnyType(kitId);
            if (!loaded || loaded.type !== 'kititem') {
                log.audit('kitCartonResolver', 'Sold kit ' + kitId + ' could not be loaded as a kit item, skipping layout');
                continue;
            }
            var kitRec = loaded.rec;

            // Every member inventory item is "kit-derived" for match-vs-legacy decisions.
            var members = getKitMemberItemIds(kitRec);
            for (var mi = 0; mi < members.length; mi++) {
                kitMemberSet[members[mi]] = true;
            }

            var noBoxes = parseInt(kitRec.getValue({ fieldId: NO_BOXES_FIELD }), 10) || 0;

            if (noBoxes < 1) {
                // No explicit carton layout. Treat the kit itself as a single box,
                // using the kit's own shipping dimensions and its full member set.
                var selfDims = {
                    length: parseDim(kitRec.getValue({ fieldId: DIM_LENGTH })),
                    width: parseDim(kitRec.getValue({ fieldId: DIM_WIDTH })),
                    height: parseDim(kitRec.getValue({ fieldId: DIM_HEIGHT }))
                };
                if (selfDims.length <= 0 || selfDims.width <= 0 || selfDims.height <= 0) {
                    throw error.create({
                        name: 'KIT_MISSING_DIMS',
                        message: 'Sold kit ' + kitId + ' has no carton layout (custitem_fmt_no_boxes) and is ' +
                            'missing shipping dimensions. Cannot determine shipping dimensions.'
                    });
                }
                boxDefs.push({
                    cartonSkuId: String(kitId),
                    dims: selfDims,
                    weight: parseDim(kitRec.getValue({ fieldId: SHIP_WEIGHT })),
                    invItemSet: members
                });
                continue;
            }

            var boxesToRead = Math.min(noBoxes, MAX_CARTON_SKUS);
            for (var b = 1; b <= boxesToRead; b++) {
                var cartonSkuId = kitRec.getValue({ fieldId: CARTON_SKU_PREFIX + b });
                if (!cartonSkuId) {
                    throw error.create({
                        name: 'KIT_CARTON_SKU_MISSING',
                        message: 'Sold kit ' + kitId + ' declares ' + noBoxes + ' boxes but ' +
                            CARTON_SKU_PREFIX + b + ' is empty. Cannot determine shipping dimensions ' +
                            'for box ' + b + '.'
                    });
                }
                boxDefs.push(buildBoxDefFromCartonSku(cartonSkuId, kitId));
            }
        }

        log.debug('kitCartonResolver', 'Built ' + boxDefs.length + ' box definition(s) from ' +
            kitIds.length + ' sold kit(s) for fulfillment ' + fulfillmentId);

        return {
            boxDefs: boxDefs,
            kitMemberSet: kitMemberSet,
            kitCount: kitIds.length
        };
    }

    /**
     * Distinct inventory item ids packed in a carton (from PackShip records).
     */
    function getCartonInventoryItemIds(cartonRecords) {
        var ids = [];
        for (var i = 0; i < cartonRecords.length; i++) {
            var itemId = cartonRecords[i].item;
            if (itemId && ids.indexOf(String(itemId)) === -1) {
                ids.push(String(itemId));
            }
        }
        return ids;
    }

    return {
        buildKitBoxDefs: buildKitBoxDefs,
        resolveCartonBox: resolveCartonBox,
        getCartonInventoryItemIds: getCartonInventoryItemIds,
        // exported for unit testing
        _pure: {
            resolveCartonBox: resolveCartonBox,
            isSubset: isSubset,
            toIdSet: toIdSet
        }
    };
});
