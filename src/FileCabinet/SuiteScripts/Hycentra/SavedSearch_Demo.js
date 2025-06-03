/**
 * SuiteScript to generate a report of all active kits/packages with available quantities
 * that fall below a specified threshold.
 */

// Define the threshold custom field ID
var THRESHOLD_CUSTOM_FIELD_ID = 'custentity_threshold';

/**
 * Main function to generate the report and send the email.
 */
function generateReportAndEmail() {
  // Load the current user's account ID
  var accountId = nlapiGetContext().getCompany();

  // Define the search filters to find all active kit/package records
  var filters = [
    new nlobjSearchFilter('type', null, 'anyof', 'Kit', 'Assembly'),
    new nlobjSearchFilter('isinactive', null, 'is', 'F')
  ];

  // Define the columns to include in the search results
  var columns = [
    new nlobjSearchColumn('itemid'),
    new nlobjSearchColumn('custitem_available_quantity'),
    // Example of formatting a number as a float with one decimal place
    new nlobjSearchColumn({
      name: 'formulanumeric',
      formula: 'TO_NUMBER({custitem_available_quantity}, \'0.0\')',
      label: 'Available Quantity (Float)'
    }),
    new nlobjSearchColumn('custentity_threshold', 'customer')
  ];

  // Create the search object
  var search = nlapiCreateSearch('item', filters, columns);

  // Run the search
  var searchResults = search.runSearch().getResults(0, 1000);

  // Loop through the search results and update the available quantity
  for (var i = 0; i < searchResults.length; i++) {
    var searchResult = searchResults[i];
    var itemId = searchResult.getValue('itemid');
    var availableQuantity = searchResult.getValue('custitem_available_quantity');
    // var threshold = searchResult.getValue('custentity_threshold', 'customer');
    var threshold = 4;

    // If the threshold is set and the available quantity is below it, set the available quantity to 0
    if (threshold && availableQuantity < threshold) {
      availableQuantity = 0;
    }

    // Update the search result with the new available quantity value
    searchResult.setValue('custitem_available_quantity', availableQuantity);
  }

  // Send an email with the search results to the specified recipient
  var emailBody = searchResults.toString();
  nlapiSendEmail('james.lui@hycentra.com', accountId + ' - Kit/Package Stock Report', emailBody);
}

/**
 * SuiteScript 2.0 example of creating a Saved Search with a float-formatted column
 */
define(['N/search', 'N/format'], function(search, format) {
  
  function createSavedSearchWithFloatColumn() {
    // Create a new saved search
    var savedSearch = search.create({
      type: search.Type.ITEM,
      filters: [
        ['type', search.Operator.ANYOF, 'Kit'],
        'AND',
        ['isinactive', search.Operator.IS, 'F']
      ],
      columns: [
        search.createColumn({name: 'itemid', label: 'Item ID'}),
        search.createColumn({name: 'custitem_available_quantity', label: 'Available Quantity'}),
        // Example of formatting a number as a float with one decimal place
        search.createColumn({
          name: 'formulanumeric',
          formula: 'TO_NUMBER({custitem_available_quantity}, \'0.0\')',
          label: 'Available Quantity (Float)'
        })
      ],
      title: 'Items with Float Formatted Quantities'
    });
    
    // Save the search
    var searchId = savedSearch.save();
    
    return searchId;
  }
  
  return {
    createSavedSearchWithFloatColumn: createSavedSearchWithFloatColumn
  };
});