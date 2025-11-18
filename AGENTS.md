# NetSuite SuiteScript Development Guide

This workspace is for NetSuite SuiteScript development. Follow these guidelines when assisting with code, architecture, and implementation.

## Project Context

This is a NetSuite development environment focused on:
- Custom SuiteScript 2.1 development
- Business process automation
- Integration with external systems
- Custom record and field management
- Performance optimization

## Core Principles

### 1. Always Use SuiteScript 2.1
- Prefer SuiteScript 2.1 over 2.0 when possible
- Use ES6 module syntax: `define(['N/record', 'N/search'], (record, search) => { ... })`
- Never use SuiteScript 1.0 unless maintaining legacy code

### 2. Follow NetSuite Best Practices
- **Governance limits**: Always consider script governance (units, time, memory)
- **Error handling**: Wrap all operations in try-catch blocks
- **Logging**: Use appropriate log levels (DEBUG, AUDIT, ERROR, EMERGENCY)
- **Performance**: Minimize record loads, use searches efficiently
- **Transactions**: Use dynamic mode for record operations when possible

### 3. Script Types & Use Cases

#### User Event Scripts
- **beforeLoad**: UI customization, field defaults, form modifications
- **beforeSubmit**: Validation, field calculations, pre-save logic
- **afterSubmit**: Related record updates, notifications, external integrations
- Always check `context.type` (create, edit, delete, etc.)

#### Client Scripts
- Use sparingly due to browser performance impact
- Validate user input before submission
- Provide immediate UI feedback
- Never perform searches or record operations in fieldChanged
- Use pageInit, validateField, saveRecord, fieldChanged appropriately

#### Scheduled Scripts
- Break large operations into batches
- Track progress using custom records or script parameters
- Implement recovery/resume logic for failures
- Use governance monitoring: `runtime.getCurrentScript().getRemainingUsage()`

#### RESTlet Scripts
- Implement GET, POST, PUT, DELETE methods as needed
- Always validate input parameters
- Return consistent JSON response structures
- Handle authentication and authorization
- Use proper HTTP status codes

#### Suitelet Scripts
- Build custom UI forms and applications
- Use serverWidget module for form creation
- Implement proper state management
- Handle both GET and POST requests

#### Map/Reduce Scripts
- Best for processing large datasets
- Implement getInputData, map, reduce, summarize stages
- Handle errors gracefully in each stage
- Use yielding to manage governance

### 4. Module Usage Guidelines

#### N/record Module
```javascript
// Create records
const salesOrder = record.create({
    type: record.Type.SALES_ORDER,
    isDynamic: true
});

// Load records
const customer = record.load({
    type: record.Type.CUSTOMER,
    id: customerId
});

// Submit records
const recordId = salesOrder.save();
```

#### N/search Module
```javascript
// Create searches programmatically
const customerSearch = search.create({
    type: search.Type.CUSTOMER,
    filters: [
        ['email', 'isnotempty', ''],
        'AND',
        ['datecreated', 'within', 'thisyear']
    ],
    columns: [
        'entityid',
        'email',
        'datecreated'
    ]
});

// Process results efficiently
customerSearch.run().each((result) => {
    // Process each result
    return true; // Continue processing
});
```

#### N/query Module (SuiteScript 2.1)
```javascript
// Use SuiteAnalytics Workbook query for complex joins
const myQuery = query.create({
    type: query.Type.TRANSACTION
});

const customerJoin = myQuery.autoJoin({
    fieldId: 'customer'
});

myQuery.columns = [
    myQuery.createColumn({ fieldId: 'tranid' }),
    customerJoin.createColumn({ fieldId: 'companyname' })
];

const results = myQuery.run();
```

### 5. Error Handling Patterns

```javascript
try {
    // Your operation
    const record = record.load({ type: 'customer', id: id });
    
} catch (e) {
    log.error({
        title: 'Error Loading Customer',
        details: {
            error: e.message,
            stack: e.stack,
            customerId: id
        }
    });
    
    // Re-throw if critical
    throw error.create({
        name: 'CUSTOMER_LOAD_ERROR',
        message: `Failed to load customer ${id}: ${e.message}`,
        notifyOff: false
    });
}
```

### 6. Governance Management

```javascript
// Check remaining governance
const script = runtime.getCurrentScript();
const remainingUsage = script.getRemainingUsage();

if (remainingUsage < 100) {
    // Yield execution or reschedule
    log.audit('Low Governance', `Remaining: ${remainingUsage}`);
}

// For Scheduled Scripts - reschedule if needed
if (remainingUsage < threshold) {
    const scheduledScript = task.create({
        taskType: task.TaskType.SCHEDULED_SCRIPT,
        scriptId: script.id,
        deploymentId: script.deploymentId,
        params: { /* state params */ }
    });
    scheduledScript.submit();
}
```

### 7. Common Patterns

#### Safe Field Value Setting
```javascript
// Check if field exists before setting
if (record.getValue({ fieldId: 'custbody_myfield' }) !== undefined) {
    record.setValue({
        fieldId: 'custbody_myfield',
        value: 'New Value'
    });
}
```

#### Sublist Operations (Dynamic Mode)
```javascript
// Add line to sublist
record.selectNewLine({ sublistId: 'item' });
record.setCurrentSublistValue({
    sublistId: 'item',
    fieldId: 'item',
    value: itemId
});
record.setCurrentSublistValue({
    sublistId: 'item',
    fieldId: 'quantity',
    value: 5
});
record.commitLine({ sublistId: 'item' });
```

#### Safe Search Result Processing
```javascript
const searchResults = [];
const pagedData = search.create({ /* ... */ }).runPaged({ pageSize: 1000 });

pagedData.pageRanges.forEach((pageRange) => {
    const page = pagedData.fetch({ index: pageRange.index });
    page.data.forEach((result) => {
        searchResults.push({
            id: result.id,
            value: result.getValue({ name: 'fieldname' })
        });
    });
});
```

### 8. Code Organization

```
/src
  /FileCabinet
    /SuiteScripts
      /[Company Prefix]
        /UserEvent
        /Client
        /Scheduled
        /RESTlet
        /Suitelet
        /MapReduce
        /Library
          /common.js
          /constants.js
          /utils.js
```

### 9. Testing Considerations

- Test with multiple record types and scenarios
- Test with different user roles and permissions
- Verify governance usage in production-like volumes
- Test error conditions and edge cases
- Use try-catch blocks and log all errors
- Test in sandbox before deploying to production

### 10. Common Gotchas

- **Field IDs**: Internal IDs vs labels (use internal IDs)
- **Dynamic vs Standard Mode**: Know when to use each
- **Joined Fields**: Use proper notation (e.g., 'custbody_field.name')
- **Date Handling**: NetSuite dates are Date objects, format appropriately
- **Decimal Numbers**: Use parseFloat() for financial calculations
- **Text Field Limits**: Respect field length limits (watch for 999 char limit)
- **Line Level Fields**: Use getSublistValue() not getValue()
- **Search Limits**: 4000 results max without pagination
- **Governance**: Each record operation consumes units

### 11. Security Best Practices

- Validate all user inputs
- Use parameterized queries to prevent injection
- Check user permissions before operations
- Never log sensitive data (passwords, credit cards, SSN)
- Use HTTPS for external integrations
- Implement proper error messages (don't expose system details)

### 12. Performance Optimization

- **Avoid**: Loading full records when only needing field values
- **Use**: lookupFields() for reading single field values
- **Batch**: Group operations to minimize script executions
- **Cache**: Store frequently accessed data in script/runtime parameters
- **Search**: Use filters instead of post-processing results
- **Async**: Use promise-based patterns for parallel operations

### 13. Deployment Checklist

- [ ] Code reviewed and tested in sandbox
- [ ] Error handling implemented
- [ ] Logging added for debugging
- [ ] Governance usage verified
- [ ] Script parameters documented
- [ ] User permissions configured
- [ ] Deployment record created
- [ ] Schedule configured (for scheduled scripts)
- [ ] Monitoring plan established

### 14. Common NetSuite Modules

- **N/record**: Record operations (CRUD)
- **N/search**: Saved and dynamic searches
- **N/query**: SuiteAnalytics queries (2.1)
- **N/runtime**: Script runtime information
- **N/log**: Logging functionality
- **N/error**: Error creation
- **N/format**: Date/number formatting
- **N/url**: URL generation
- **N/https**: HTTP/S requests
- **N/file**: File operations
- **N/email**: Email sending
- **N/render**: PDF/template rendering
- **N/task**: Task creation (scheduled, map/reduce, etc.)
- **N/ui/serverWidget**: UI form creation
- **N/transaction**: Transaction processing

### 15. Debugging Tips

- Use log.debug() liberally during development
- Check Execution Log (Setup > Management > View Execution Logs)
- Use Browser DevTools for Client Scripts
- Test with System Administrator role first
- Use Script Debugger for complex issues
- Monitor governance in Script Execution Log

## NetSuite-Specific Terminology

- **Internal ID**: Unique numeric identifier for records
- **Script ID**: Custom identifier for scripts/records (e.g., 'customscript_my_script')
- **Governance Units**: Limits on script resource consumption
- **Sublist**: Line items (e.g., items on a sales order)
- **Body Field**: Header-level field on a record
- **Joined Field**: Field from related record accessed via join
- **Bundle**: Packaged collection of customizations
- **SDF**: SuiteCloud Development Framework (IDE-based development)

## When Providing Code

1. Always include proper error handling
2. Add comments explaining NetSuite-specific logic
3. Include governance considerations if relevant
4. Specify which script type the code is for
5. Note any dependencies on custom fields/records
6. Include deployment/configuration notes
7. Provide example use cases

## Integration Patterns

### RESTlet Integration
```javascript
/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/record', 'N/error'], (record, error) => {
    
    const post = (requestBody) => {
        try {
            // Validate input
            if (!requestBody.customerId) {
                throw error.create({
                    name: 'MISSING_PARAMETER',
                    message: 'customerId is required'
                });
            }
            
            // Process request
            const customer = record.load({
                type: record.Type.CUSTOMER,
                id: requestBody.customerId
            });
            
            return {
                success: true,
                data: {
                    id: customer.id,
                    name: customer.getValue({ fieldId: 'companyname' })
                }
            };
            
        } catch (e) {
            log.error('RESTlet Error', e);
            return {
                success: false,
                error: e.message
            };
        }
    };
    
    return { post };
});
```

## Questions to Ask for Context

When starting a new task, consider asking:
- What script type is needed?
- What triggers the script?
- What records are involved?
- Are there governance concerns (volume)?
- Are there dependencies on custom fields/records?
- What's the desired behavior on error?
- Which roles need access?

## Useful Resources

- NetSuite Help Center: https://system.netsuite.com/app/help/helpcenter.nl
- SuiteAnswers: Search for "SuiteScript 2.1" topics
- SuiteScript API Browser: In NetSuite, go to Documents > SuiteCloud > SuiteScript API Reference
- NetSuite Debugger: Setup > Scripting > Script Debugger

---

**Remember**: Always prioritize governance efficiency, error handling, and maintainability. NetSuite scripts run in a resource-constrained environment, so efficient code is critical. Ask me for clarifications if in doubt and don't make any assumptions