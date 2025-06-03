/*
 * itemFormHelper.js
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
*/

define(['N/record', 'N/search', 'N/log'], 
    function (record, search, log) {

		function getFormCategoryId(itemType, categoryId, formId) {
            // Get the Category ID base on the provided Form ID
            var customRecordSearch = search.create({
                type: 'customrecord_hyc_item_kit_form_map',
                filters: [
                    ['custrecord_hyc_item_form_item_type', search.Operator.IS, itemType], // Filter for item type
                    'and',
                    ['custrecord_hyc_item_form_map_category', search.Operator.IS, categoryId], // Filter for category 
                    'and',
                    ['custrecord_hyc_item_form_form_id', search.Operator.EQUALTO, formId] // Filter for specific form ID
                ],
                columns: [
                    'custrecord_hyc_item_form_map_category'
                ]
            });

            var searchResult = customRecordSearch.run().getRange({ start: 0, end: 1});

            if (searchResult.length > 0) {
                var categoryId = searchResult[0].getValue('custrecord_hyc_item_form_map_category');
                return categoryId;
            }

            return null;
        }

        function getCategoryFormId(itemType, categoryId) {
            // Get the Form ID base on the provided Category ID
            var customRecordSearch = search.create({
                type: 'customrecord_hyc_item_kit_form_map',
                filters: [
                    ['custrecord_hyc_item_form_item_type', search.Operator.IS, itemType], // Filter for item type
                    'and',
                    ['custrecord_hyc_item_form_map_category', search.Operator.IS, categoryId] // Filter for specific form ID
                ],
                columns: [
                    'custrecord_hyc_item_form_form_id'
                ]
            });

            var searchResult = customRecordSearch.run().getRange({ start: 0, end: 1});

            if (searchResult.length > 0) {
                return searchResult[0].getValue('custrecord_hyc_item_form_form_id');
            }

            return null;
        }

        // This function is created to map the Netsuite ENUM is a string where the custom record is storing the ID
        function getItemTypeId(itemType) {
            var itemTypeId = itemType;

            if (itemTypeId && isNaN(itemTypeId)) {
                if (itemTypeId === record.Type.KIT_ITEM) {
                    itemTypeId = 6;
                } else if (itemTypeId === record.Type.INVENTORY_ITEM) {
                    itemTypeId = 1;
                }
            }

            return itemTypeId;
        }

		return {
            getFormCategoryId: getFormCategoryId,
			getCategoryFormId: getCategoryFormId,
            getItemTypeId: getItemTypeId
		}
	}
);