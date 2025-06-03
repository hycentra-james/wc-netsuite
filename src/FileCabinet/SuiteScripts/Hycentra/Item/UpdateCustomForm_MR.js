/**
 * @NApiVersion 2.x
 * @NScriptType MapReduceScript
 */
define(['N/search', 'N/record', 'N/runtime', 'N/log'], function (search, record, runtime, log) {

    // Category-to-Form Map
    const CATEGORY_FORM_MAP = {
        INVENTORY_ITEM: {
            12: 199,
            10: 307,
            1: 308,
            7: 309,
            5: 310,
            8: 311,
            13: 311,
            14: 311,
            15: 311,
            16: 311,
            17: 311,
            18: 311,
            19: 311,
            20: 311,
            21: 311,
            22: 311,
            24: 311,
            25: 311,
            26: 311,
            27: 311,
            28: 311,
            9: 312,
            4: 313,
            3: 314,
            6: 315,
            2: 316,
        },
        KIT_ITEM: {
            1: 318,
            8: 319,
            13: 319,
            14: 319,
            15: 319,
            16: 319,
            17: 319,
            18: 319,
            19: 319,
            20: 319,
            21: 319,
            22: 319,
            24: 319,
            25: 319,
            26: 319,
            27: 319,
            28: 319,
            4: 320,
            3: 321,
            2: 322,
        }
    };

    function getInputData() {
        // Search for both Inventory Items and Kit Items
        return search.create({
            type: search.Type.INVENTORY_ITEM,                           // REVIEW THIS
            //type: search.Type.KIT_ITEM,
            filters: [
                ['isinactive', search.Operator.IS, 'F'],
                'AND',
                ['type', search.Operator.ANYOF, 'InvtPart'],            // REVIEW THIS
                //['type', search.Operator.ANYOF, 'Kit'],
                'AND',
                //['class', search.Operator.ANYOF, [1]]
                ['class', search.Operator.ANYOF, [1,2,3,4,5,6,7,8,9,10,12,13,14,15,16,17,18,19,20,21,22,24,25,26,27,28]] // Item - All Categories
                //['class', search.Operator.ANYOF, [1,2,3,4,5,6,7,8,9,10,12]] // Kit - All Categories
                //['class', search.Operator.ANYOF, [8,13,14,15,16,17,18,19,20,21,22,24,25,26,27,28]]  // All Faucet
                //['internalId', search.Operator.ANYOF, [8176,8177,439]]
                
            ],
            columns: ['internalid', 'type', 'class']
        });
    }

    function map(context) {
        var searchResult = JSON.parse(context.value);
        var itemId = searchResult.id;
        var itemType = searchResult.values.type.value; // Internal ID of type
        var categoryId = searchResult.values.class.value; // Internal ID of Category (Class)
        var recordType = itemType === 'InvtPart' ? 'INVENTORY_ITEM' : 'KIT_ITEM';
        var formMap = CATEGORY_FORM_MAP[recordType];
        var formId = formMap ? formMap[categoryId] : null;

        if (formId) {
            try {
                record.submitFields({
                    type: itemType === 'InvtPart' ? record.Type.INVENTORY_ITEM : record.Type.KIT_ITEM,
                    id: itemId,
                    values: {
                        customform: formId
                    }
                });
                log.debug('Updated Item', 'Item ID: ' + itemId + ' Form ID: ' + formId);
            } catch (e) {
                log.error('Error Updating Item', 'Item ID: ' + itemId + ', Error: ' + e.message);
            }
        } else {
            log.debug('No Matching Form ID', 'Item ID: ' + itemId + ', Category ID: ' + categoryId);
        }
    }

    return {
        getInputData: getInputData,
        map: map
    };
});