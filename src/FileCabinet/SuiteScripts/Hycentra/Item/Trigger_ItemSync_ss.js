/**
 * @NApiVersion 2.x
 * @NScriptType ScheduledScript
 *
 * WC-563: Bulk re-sync utility - now submits to Map/Reduce instead of Scheduled Script
 * -------------------------------------------------------------------------------------
 * Searches for inventory items by class filter, then submits all IDs to the
 * ItemFieldsSync_MR Map/Reduce script for processing. The MR script handles
 * each item independently in the map stage, avoiding the queue collision issue
 * that plagued the old SS approach.
 *
 * Usage: Adjust the class filter in the search below, then run this script
 * manually from the Script Deployment page.
 */
define(['N/record', 'N/log', 'N/search', 'N/task'], function (record, log, search, task) {

    function execute(context) {
        // Perform a search to find Inventory Item records by class
        // Adjust the class filter as needed for the batch you want to re-sync
        var itemSearch = search.create({
            type: search.Type.INVENTORY_ITEM,
            //filters: [
                // ['class', search.Operator.ANYOF, [2, 10]] // (Washstands + Bath Access)
                // Uncomment/modify as needed:
                // ['class', search.Operator.ANYOF, [1, 3, 4]] // Vanity + TT + LC
                // ['class', search.Operator.ANYOF, [2, 12, 10, 5]] // Washstands + Backsplash + Bath Access + Counter Tops
                // ['class', search.Operator.ANYOF, [13, 14, 15, 17, 19, 20, 21, 22, 24, 25, 26, 27, 28]] // All Faucet
            //],
            columns: ['internalid']
        });

        var itemIdArray = [];
        itemSearch.run().each(function (result) {
            itemIdArray.push(result.getValue('internalid'));
            return true;
        });

        if (itemIdArray.length === 0) {
            log.audit('Trigger_ItemSync', 'No items found matching the search criteria');
            return;
        }

        log.audit('Trigger_ItemSync', 'Found ' + itemIdArray.length + ' items to sync');

        // Submit to Map/Reduce instead of Scheduled Script.
        // MR processes each item independently in the map stage, so all items get synced
        // regardless of how many there are (no queue collision).
        try {
            var mrTask = task.create({
                taskType: task.TaskType.MAP_REDUCE,
                scriptId: 'customscript_hyc_item_fields_sync_mr',
                deploymentId: 'customdeploy_hyc_item_fields_sync_mr',
                params: {
                    custscript_mr_item_ids: itemIdArray.join(',')
                }
            });

            var taskId = mrTask.submit();
            log.audit('Trigger_ItemSync', 'MR Task submitted: ' + taskId + ' with ' + itemIdArray.length + ' items');

        } catch (e) {
            log.error('Trigger_ItemSync', 'Failed to submit MR task: ' + e.message);
        }
    }

    return {
        execute: execute
    };
});
