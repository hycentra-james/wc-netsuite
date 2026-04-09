/**
 * @NApiVersion 2.x
 * @NScriptType UserEventScript
 *
 * WC-563: Kit Field Sync - User Event (Queue Collision Fix)
 * ----------------------------------------------------------
 * Previously, this UE submitted a Scheduled Script task per item save.
 * During bulk CSV imports, only the first item's sync ran because
 * subsequent task.submit() calls failed silently (same SS deployment
 * was already queued/running).
 *
 * Fix: Submit a Map/Reduce task instead. Map/Reduce supports multiple
 * queued invocations better than Scheduled Scripts. Additionally, if the
 * MR task submission fails (deployment busy), the item will still be
 * picked up by the scheduled MR safety-net run (searches for recently
 * modified items every 15 minutes).
 *
 * The form ID gate logic is preserved: only items on the configured
 * custom forms trigger a sync.
 */
define(['N/task', 'N/log', 'N/runtime'], function (task, log, runtime) {

    // Valid custom form IDs that should trigger kit field sync
    var VALID_FORM_IDS = [199, 306, 307, 308, 309, 310, 311, 312, 313, 314, 315, 316];

    function afterSubmit(context) {
        if (context.type !== context.UserEventType.CREATE && context.type !== context.UserEventType.EDIT) {
            return;
        }

        var newRecord = context.newRecord;
        var formId = parseInt(newRecord.getValue({ fieldId: 'customform' }), 10);

        if (isNaN(formId) || VALID_FORM_IDS.indexOf(formId) === -1) {
            return;
        }

        var itemId = newRecord.id;
        log.debug('ItemFieldsSync_UE', 'Item ' + itemId + ' saved on form ' + formId + ', triggering sync');

        try {
            // Submit a Map/Reduce task with this item ID.
            // MR handles parallel processing and governance limits better than SS.
            // If another MR task is already queued/running, NetSuite will queue this one
            // (MR supports up to 5 concurrent executions per deployment, unlike SS which allows only 1).
            var mrTask = task.create({
                taskType: task.TaskType.MAP_REDUCE,
                scriptId: 'customscript_hyc_item_fields_sync_mr',
                deploymentId: 'customdeploy_hyc_item_fields_sync_mr',
                params: {
                    custscript_mr_item_ids: String(itemId)
                }
            });

            var taskId = mrTask.submit();
            log.debug('ItemFieldsSync_UE', 'MR Task submitted: ' + taskId + ' for Item ID: ' + itemId);

        } catch (e) {
            // If MR submission fails (e.g., all deployments busy), log it.
            // The item will be picked up by the scheduled MR safety-net run
            // which searches for recently modified items on valid forms.
            log.audit('ItemFieldsSync_UE',
                'MR task submission failed for Item ' + itemId +
                '. Item will be picked up by scheduled MR safety-net run. Error: ' + e.message
            );
        }
    }

    return {
        afterSubmit: afterSubmit
    };
});
