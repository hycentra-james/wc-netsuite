/**
 * @NApiVersion 2.x
 * @NScriptType UserEventScript
 */
define(['N/task', 'N/log'], function(task, log) {

    function afterSubmit(context) {
        if (context.type === context.UserEventType.CREATE || context.type === context.UserEventType.EDIT) {
            var newRecord = context.newRecord;

            // List of valid form IDs
            var formIds = [199, 306, 307, 308, 309, 310, 311, 312, 313, 314, 315, 316];

            var formId = parseInt(newRecord.getValue({ fieldId: 'customform' }));
            if (!isNaN(formId) && formIds.indexOf(formId) !== -1) {
                var itemId = newRecord.id;

                log.debug('DEBUG', 'itemId = ' + itemId);

                try {
                    // Submit the Scheduled Script
                    var scriptTask = task.create({
                        taskType: task.TaskType.SCHEDULED_SCRIPT,
                        scriptId: 'customscript_hyc_item_fields_sync_ss', // Script ID
                        deploymentId: 'customdeploy_hyc_item_fields_sync_ss_dpl', // Deployment ID
                        params: {
                            custscript_item_id: itemId
                        }
                    });

                    var taskId = scriptTask.submit();
                    log.debug('Scheduled Script Submitted', 'Task ID: ' + taskId);

                } catch (e) {
                    log.error('Error Submitting Scheduled Script', e.message);
                }
            }
        }
    }

    return {
        afterSubmit: afterSubmit
    };
});