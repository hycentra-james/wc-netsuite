/**
 *@NApiVersion 2.x
 *@NScriptType ClientScript
 */
 define(['N/error', 'N/runtime'], function(error, runtime) {
    function pageInit(context) {
        var currentUser = runtime.getCurrentUser();

        // currentUser.id
        if (context.mode === 'create' || context.mode === 'edit' ) {
            var currentRecord = context.currentRecord;

            var manualApprovalCB = currentRecord.getField('custbody_hyc_vb_manual_approval');
            var secApproverDD = currentRecord.getField('custbody_hyc_vb_sec_approver');
            var approvalStatusDD = currentRecord.getField('approvalstatus');
            
            manualApprovalCB.isDisabled = false;
            secApproverDD.isDisabled = true;
            
            if (currentUser.id === currentRecord.getValue({fieldId: 'nextapprover'})) {
                approvalStatusDD.isDisabled = false;
            }

            // If edit mode
            if (context.mode === 'edit') {
                var manualApproval = currentRecord.getValue({ fieldId: 'custbody_hyc_vb_manual_approval'});
                var secApprover = currentRecord.getValue({ fieldId: 'custbody_hyc_vb_sec_approver'});

                if (manualApproval && secApprover) {
                    secApproverDD.isDisabled = false;
                }
            }
        }
    }

    function fieldChanged(context) {
        var currentRecord = context.currentRecord;
        
        var manualApprovalCB = currentRecord.getValue({ fieldId: 'custbody_hyc_vb_manual_approval'});
        var secApproverDD = currentRecord.getField('custbody_hyc_vb_sec_approver');

        secApproverDD.isDisabled = !manualApprovalCB;
    }
    
    return {
        pageInit: pageInit,
        fieldChanged: fieldChanged
    };
}); 

