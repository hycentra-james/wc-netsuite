/**
 * @NApiVersion 2.x
 * @NScriptType UserEventScript
 */
define(['N/ui/serverWidget', 'N/runtime', 'N/url'], function (ui, runtime, url) {
    function beforeLoad(context) {
        if (context.type === context.UserEventType.VIEW || context.type === context.UserEventType.EDIT) {
            var form = context.form;
            var record = context.newRecord;
            var caseId = record.id;

            var isEmailSent = record.getValue({ fieldId: 'custevent_hyc_rmafileoutboundclaim' });
            
            if (!isEmailSent) {
                var buildURL = url.resolveScript({
                    'scriptId':'customscript_hyc_rmafileoutbound_suitele',
                    'deploymentId':'customdeploy_hyc_rmafileoutbound_suitele',
                    'returnExternalUrl': false
                   }) + '&caseid=' + caseId;
                form.addButton({
                    id: 'custpage_send_case_email',
                    label: 'RMA Claim',
                    functionName: 'window.open(\'' + buildURL + '\')'
                });
            }
        }
    }

    return {
        beforeLoad: beforeLoad
    };
});