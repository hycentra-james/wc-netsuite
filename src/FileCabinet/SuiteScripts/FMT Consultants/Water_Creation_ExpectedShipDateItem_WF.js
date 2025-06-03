   /**
    *@NApiVersion 2.0
    *@NScriptType workflowactionscript
    */
   define(['N/search', 'N/record', 'N/email', 'N/runtime', 'N/render','N/url','N/format'],
   function(search, record, email, runtime, render,url,format) {
       
       function execute(context) {
   
           try{

                var currRecord = context.newRecord;
                currRecord = currRecord.id;
                log.debug('This is my ID',currRecord);

                var myRecord = record.load({
                    type: record.Type.SALES_ORDER,
                    id: currRecord,
                    isDynamic: false
                });

                log.debug('you have loaded record',myRecord);

                var lineCount = myRecord.getLineCount('item');

                var myDate = myRecord.getValue('trandate');

                var locationArray = [];
                var itemArray = [];

                var myItem, myQuantity, myCommitedQuantity, myLocation, searchResults, myHeaderLocation;

                myHeaderLocation = myRecord.getValue('location');
                if(myHeaderLocation){
                    locationArray.push(myHeaderLocation);
                }

                for(var i = 0; i < lineCount; i++){
                    myItem = myRecord.getSublistValue('item','item',i);
                    myQuantity = myRecord.getSublistValue('item','quantity',i);
                    myCommitedQuantity = myRecord.getSublistValue('item','quantitycommitted',i);
                    myLocation = myRecord.getSublistValue('item','location',i);
                    log.debug('This is my Location',myLocation);

                    if(myQuantity != myCommitedQuantity){
                        log.debug('This line is on Back Order',i);

                        if(locationArray.indexOf(myLocation) == -1 && myLocation != ''){
                        locationArray.push(myLocation)
                        }

                        if(itemArray.indexOf(myItem) == -1){
                            itemArray.push(myItem);
                        }
                    }
                }

                log.debug('These are my locations',locationArray);
                log.debug('These are my items',itemArray);

                searchResults = findMyReceipts(locationArray,itemArray);
                log.debug('This is what my search returns',searchResults);

                var myReceiptDate;

                for(var i = 0; i < lineCount; i++){
                    myItem = myRecord.getSublistValue('item','item',i);
                    log.debug('I am on line',i);

                    myReceiptDate = calcDate(searchResults[myItem],myDate);
                    log.debug('This is your Receipt Date to be set at the line without weekends',myReceiptDate);

                    myReceiptDate = checkforWeekend(myReceiptDate);

                    myRecord.setSublistValue('item','custcol_lb_expectedshipdate',i,myReceiptDate);

                    log.debug('This is your Receipt Date to bet Set',myReceiptDate);
                    
                }

                var newOrder = myRecord.save(false,false);

                log.debug('You have saved Order',newOrder);

                //going to do the date logic now
                //so its expected receipt date + 10
                //if nothing is found, its transaction date + 90

                //check for weekend etc - convert to following monday
                //set field value



   
                       
            } catch(e){
                log.debug('This is your error',e);
                log.debug('Script is now Ending');
            }

            function findMyReceipts(myLocations,myItems){
                var res = {};

                var transactionSearchObj = search.create({
                    type: "transaction",
                    filters:
                    [
                       ["type","anyof","PurchOrd","InbShip"], 
                       "AND", 
                       ["status","anyof","PurchOrd:B"], 
                       "AND", 
                       ["mainline","is","F"], 
                       "AND", 
                       ["shipping","is","F"], 
                       "AND", 
                       ["taxline","is","F"], 
                       "AND", 
                       ["item","anyof",myItems],
                    //    "AND",
                    //    ["location","anyof",myLocations]
                    ],
                    columns:
                    [
                       search.createColumn({
                          name: "item",
                          summary: "GROUP",
                          label: "Item"
                       }),
                       search.createColumn({
                          name: "expectedreceiptdate",
                          summary: "MAX",
                          label: "Expected Receipt Date"
                       })
                    ]
                 });

                 transactionSearchObj.run().each(function(result){
                    // .run().each has a limit of 4,000 results
                    log.debug('These are my Search Results',result);

                    res[result.getValue({
                        name: "item",
                        summary: "GROUP"
                    })] = result.getValue({
                        name: "expectedreceiptdate",
                        summary: "MAX"
                    });
                    return true;
                 });

                 return res;

            }

            function calcDate(receiptDate,trandate){

                var dateToReturn;
                var tenDayDelay = parseInt(10);
                var ninetyDayDelay = parseInt(90);

                if(!!receiptDate && receiptDate != ''){
                    log.debug('Receipt Date has a value');

                    receiptDate = new Date(receiptDate);
                    receiptDate = receiptDate.setDate(receiptDate.getDate() + tenDayDelay);

                    dateToReturn = format.parse({
                        value: new Date(receiptDate),
                        type: format.Type.DATE
                    });
                }

                else{

                    trandate = new Date(trandate);
                    trandate = trandate.setDate(trandate.getDate() + ninetyDayDelay);

                    dateToReturn = format.parse({
                        value: new Date(trandate),
                        type: format.Type.DATE
                    });
                }

                return dateToReturn;

                }

                function checkforWeekend(dateToReturn){
                    var isSaturday = parseInt(2);
                    var isSunday = parseInt(1);
                    var checkDate;


                    checkDate = dateToReturn.getDay();

                    if(checkDate === 6){
                        dateToReturn = new Date(dateToReturn);
                        dateToReturn = dateToReturn.setDate(dateToReturn.getDate() + isSaturday);

                        dateToReturn = format.parse({
                            value: new Date(dateToReturn),
                            type: format.Type.DATE
                        });
                    }

                    else if (checkDate == 0){
                        dateToReturn = new Date(dateToReturn);
                        dateToReturn = dateToReturn.setDate(dateToReturn.getDate() + isSunday);

                        dateToReturn = format.parse({
                            value: new Date(dateToReturn),
                            type: format.Type.DATE
                        });
                    }

                    else{
                        log.debug('This date is not on a Weekend');

                        dateToReturn = format.parse({
                            value: new Date(dateToReturn),
                            type: format.Type.DATE
                        });

                    }

                    return dateToReturn;
                }

              }
              return {
                  onAction: execute
              };
    }); 