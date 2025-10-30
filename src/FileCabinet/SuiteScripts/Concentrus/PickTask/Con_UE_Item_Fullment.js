/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/runtime', 'N/task', 'N/record'], (runtime, task, record) => {
    /**
     * Defines the function definition that is executed before record is loaded.
     * @param {Object} scriptContext
     * @param {Record} scriptContext.newRecord - New record
     * @param {string} scriptContext.type - Trigger type; use values from the context.UserEventType enum
     * @param {Form} scriptContext.form - Current form
     * @param {ServletRequest} scriptContext.request - HTTP request information sent from the browser for a client action only.
     * @since 2015.2
     */
    const beforeLoad = (scriptContext) => {

    }

    /**
     * Defines the function definition that is executed before record is submitted.
     * @param {Object} scriptContext
     * @param {Record} scriptContext.newRecord - New record
     * @param {Record} scriptContext.oldRecord - Old record
     * @param {string} scriptContext.type - Trigger type; use values from the context.UserEventType enum
     * @since 2015.2
     */
    const beforeSubmit = (scriptContext) => {

        // log.debug({ title: 'beforeSubmit r', details: scriptContext.newRecord.getValue({ fieldId: 'shipstatus' }) });
    }

    /**
     * Defines the function definition that is executed after record is submitted.
     * @param {Object} scriptContext
     * @param {Record} scriptContext.newRecord - New record
     * @param {Record} scriptContext.oldRecord - Old record
     * @param {string} scriptContext.type - Trigger type; use values from the context.UserEventType enum
     * @since 2015.2
     */
    const afterSubmit = (scriptContext) => {
        try {
            const status = scriptContext.newRecord.getValue({ fieldId: 'shipstatus' });
            if (status === 'A' && scriptContext.type === 'create' && runtime.executionContext === 'USEREVENT') {
                // Load the created-from Sales Order and find related wave records
                const createdFrom = scriptContext.newRecord.getValue({ fieldId: 'createdfrom' });
                if (!createdFrom) return;
                const salesOrder = record.load({
                    type: record.Type.SALES_ORDER,
                    id: createdFrom
                });

                const lines = salesOrder.getLineCount({ sublistId: 'links' });
                for (let line = 0; line < lines; line++) {
                    const type = salesOrder.getSublistValue({
                        sublistId: 'links',
                        fieldId: 'type',
                        line: line
                    });
                    log.debug({ title: 'links', details: { type } });
                    if (type !== 'Wave') continue;
                    const id = salesOrder.getSublistValue({
                        sublistId: 'links',
                        fieldId: 'id',
                        line
                    });
                    const mrTask = task.create({
                        taskType: task.TaskType.MAP_REDUCE,
                        scriptId: 'customscript_con_mr_update_if_lot', // Replace with actual script ID
                        params: {
                            custscript_wave_id: id
                        }
                    });

                    const taskId = mrTask.submit();
                    log.audit('Triggered Map/Reduce', { id, taskId });
                }
            }
        } catch (e) {
            log.error({ title: 'Error in afterSubmit', details: e });
        }
    }

    return { beforeLoad, beforeSubmit, afterSubmit }

});
