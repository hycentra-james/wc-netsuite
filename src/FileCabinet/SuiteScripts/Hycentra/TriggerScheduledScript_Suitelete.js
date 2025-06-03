/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope Public
 */
define(['N/task', 'N/ui/serverWidget'], function(task, serverWidget) {
    
    function onRequest(context) {
        if (context.request.method === 'GET') {
            // Create a form for the page
            var form = serverWidget.createForm({
                title: 'Trigger Shipping Update Script'
            });
            
            // Add a button to trigger the script
            form.addSubmitButton({
                label: 'Run Shipping Update Script'
            });
            
            // Add a field to show results (if any)
            var resultField = form.addField({
                id: 'custpage_result',
                type: serverWidget.FieldType.INLINEHTML,
                label: 'Result'
            });
            
            context.response.writePage(form);
        } 
        else if (context.request.method === 'POST') {
            // Create a form for results
            var resultForm = serverWidget.createForm({
                title: 'Script Execution Result'
            });
            
            try {
                // Schedule the script
                var scriptTask = task.create({
                    taskType: task.TaskType.MAP_REDUCE,
                    scriptId: 'customscript_lbsupp_sendship',
                    deploymentId: 'customdeploy_lbsupp_sendship'
                });
                
                var scriptTaskId = scriptTask.submit();
                
                // Show the result
                var resultField = resultForm.addField({
                    id: 'custpage_result',
                    type: serverWidget.FieldType.INLINEHTML,
                    label: 'Result'
                });
                
                resultField.defaultValue = '<p style="color:green; font-weight:bold">Script successfully triggered! Task ID: ' + scriptTaskId + '</p>';
                
                // Add a back button
                resultForm.addButton({
                    id: 'custpage_back',
                    label: 'Back',
                    functionName: 'window.history.back()'
                });
                
                context.response.writePage(resultForm);
            } 
            catch (e) {
                // Show error
                var errorField = resultForm.addField({
                    id: 'custpage_error',
                    type: serverWidget.FieldType.INLINEHTML,
                    label: 'Error'
                });
                
                errorField.defaultValue = '<p style="color:red; font-weight:bold">Error triggering script: ' + e.message + '</p>';
                
                // Add a back button
                resultForm.addButton({
                    id: 'custpage_back',
                    label: 'Back',
                    functionName: 'window.history.back()'
                });
                
                context.response.writePage(resultForm);
            }
        }
    }
    
    return {
        onRequest: onRequest
    };
});