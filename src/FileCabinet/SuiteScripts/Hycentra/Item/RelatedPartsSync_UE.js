/**
 * RelatedPartsSync_UE.js
 * User Event script deployed on customrecord_hyc_record_related_parts
 * Triggers Related Parts sync to Kits when Related Parts records are created/edited/deleted
 *
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(['N/search', 'N/task', 'N/runtime', 'N/log'], (search, task, runtime, log) => {

    /**
     * After Submit - Trigger sync when Related Parts record is created, edited, or deleted
     * @param {Object} context
     */
    const afterSubmit = (context) => {
        try {
            const eventType = context.type;

            // Handle create, edit, and delete events
            if (eventType !== context.UserEventType.CREATE &&
                eventType !== context.UserEventType.EDIT &&
                eventType !== context.UserEventType.DELETE) {
                return;
            }

            // IMPORTANT: Prevent infinite loop!
            // Only trigger sync when changes are made by USER (UI or CSV import)
            // Skip when changes are made by scripts (which is how the sync creates records)
            const executionContext = runtime.executionContext;
            const allowedContexts = [
                runtime.ContextType.USER_INTERFACE,
                runtime.ContextType.CSV_IMPORT,
                runtime.ContextType.CUSTOM_MASSUPDATE,
                runtime.ContextType.MASS_UPDATE
            ];

            if (!allowedContexts.includes(executionContext)) {
                log.debug('Skipping Sync', `Execution context is ${executionContext}, not user-initiated. Skipping to prevent loop.`);
                return;
            }

            log.audit('Related Parts Changed', `Event Type: ${eventType}, Context: ${executionContext}`);

            // Get the Base Item (inventory item) from the record
            let baseItemId;

            if (eventType === context.UserEventType.DELETE) {
                // For delete, use oldRecord since newRecord doesn't exist
                const oldRecord = context.oldRecord;
                if (!oldRecord) {
                    log.debug('No Old Record', 'DELETE event has no oldRecord, skipping');
                    return;
                }
                baseItemId = oldRecord.getValue({ fieldId: 'custrecord_hyc_itm_related_parts_baseitm' });
            } else {
                // For create/edit, use newRecord
                const newRecord = context.newRecord;
                if (!newRecord) {
                    log.debug('No New Record', `${eventType} event has no newRecord, skipping`);
                    return;
                }
                baseItemId = newRecord.getValue({ fieldId: 'custrecord_hyc_itm_related_parts_baseitm' });

                // Also check if Base Item changed (edit scenario)
                if (eventType === context.UserEventType.EDIT && context.oldRecord) {
                    const oldRecord = context.oldRecord;
                    const oldBaseItemId = oldRecord.getValue({ fieldId: 'custrecord_hyc_itm_related_parts_baseitm' });

                    // If Base Item changed, need to sync both old and new item's kits
                    if (oldBaseItemId && oldBaseItemId !== baseItemId) {
                        log.audit('Base Item Changed', `Old: ${oldBaseItemId}, New: ${baseItemId}`);
                        triggerSyncForItem(oldBaseItemId);
                    }
                }
            }

            if (!baseItemId) {
                log.debug('No Base Item', 'Related Parts record has no Base Item, skipping sync');
                return;
            }

            log.audit('Base Item Found', `Base Item ID: ${baseItemId}`);

            // Trigger sync for all Kits containing this Base Item
            triggerSyncForItem(baseItemId);

        } catch (e) {
            log.error('Error in RelatedPartsSync_UE', {
                message: e.message,
                name: e.name,
                stack: e.stack,
                eventType: context.type,
                recordId: context.newRecord?.id || context.oldRecord?.id || 'unknown'
            });
        }
    };

    /**
     * Trigger sync for all Kits containing the given inventory item
     * @param {string} itemId - The inventory item ID
     */
    const triggerSyncForItem = (itemId) => {
        try {
            // Find all Kits containing this item
            const kits = findKitsContainingItem(itemId);

            if (kits.length === 0) {
                log.debug('No Kits Found', `Item ${itemId} is not a member of any Kit`);
                return;
            }

            log.audit('Kits Found', `Found ${kits.length} Kits containing Item ${itemId}`);

            // Option 1: Trigger the existing Scheduled Script (safer for bulk)
            // This reuses the existing sync logic
            try {
                const scriptTask = task.create({
                    taskType: task.TaskType.SCHEDULED_SCRIPT,
                    scriptId: 'customscript_hyc_item_fields_sync_ss',
                    deploymentId: 'customdeploy_hyc_item_fields_sync_ss_dpl',
                    params: {
                        custscript_item_id: itemId
                    }
                });

                const taskId = scriptTask.submit();
                log.audit('Sync Triggered', `Task ID: ${taskId}, Item ID: ${itemId}`);

            } catch (taskError) {
                // If scheduled script fails (e.g., already queued), just log and skip
                // DO NOT fall back to inline sync - it exceeds governance limits during bulk operations
                log.audit('Scheduled Script Not Queued', {
                    itemId: itemId,
                    kitCount: kits.length,
                    reason: taskError.message,
                    note: 'Sync will be handled when scheduled script runs'
                });
            }

        } catch (e) {
            log.error('Error in triggerSyncForItem', `Item ID: ${itemId}, Error: ${e.message}`);
        }
    };

    /**
     * Find all Kit items that contain the given inventory item as a member
     * @param {string} itemId - The inventory item ID
     * @returns {Array} Array of Kit internal IDs
     */
    const findKitsContainingItem = (itemId) => {
        const kits = [];

        try {
            const kitSearch = search.create({
                type: search.Type.KIT_ITEM,
                filters: [
                    ['memberitem.internalid', 'anyof', itemId]
                ],
                columns: ['internalid']
            });

            kitSearch.run().each((result) => {
                kits.push(result.getValue('internalid'));
                return true; // Continue iteration
            });

        } catch (e) {
            log.error('Error in findKitsContainingItem', `Item ID: ${itemId}, Error: ${e.message}`);
        }

        return kits;
    };

    return {
        afterSubmit
    };
});
