/**
*@NApiVersion 2.x
*@NScriptType UserEventScript
*/
define(['N/record','N/search','N/log','N/ui/serverWidget','N/currentRecord'],
  function(record,search,log,serverWidget,currentRecord) {
    function beforeLoad(context) {

    if(context.type == 'edit' || context.type =='çopy')
    {

      try
      {
        var rec_id = context.newRecord.id; // get record id
        var rec_type = context.newRecord.type;

        var load_so =  record.load({
          type: rec_type,
          id: rec_id,
          isDynamic: false,
        });

        var itemCategory = load_so.getValue('class');

        log.debug({title: 'itemCategory ',details: itemCategory});

        var mySearch = search.load({​​​​​id: 'customsearch_fmt_item_configuration'}​​​​​);

        var filters = mySearch.filters; //reference Search.filters object to a new variable

        if(itemCategory)
        {​​​​​
            filters.push(search.createFilter({​​​​​ 
                name: 'custrecord_fmt_item_category',
                operator: search.Operator.ANYOF,
                values: itemCategory
            }​​​​​));
         
         	 filters.push(search.createFilter({​​​​​ 
                name: 'isinactive',
                operator: search.Operator.IS,
                values: 'F'
            }​​​​​));
        }

        /*var firstResult = mySearch.run().getRange({
        start: 0,
        end: 1
        })[0];*/

        var resultSet = mySearch.run();
        var firstResult = resultSet.getRange({
          start: 0,
          end: 1
        })[0];

        log.debug({
        details: "There are these object" + firstResult 
        });
      
        for (var i2 = 0; i2 < 1; i2++)  //firstResult.columns.length
        {
            log.debug({title: 'columLength ',details: 'Inside Loop'});

            firstResult.columns.forEach(function(col)
            { // log each column
             
              //var value = firstResult.getValue(resultSet.columns[1]);
              var searchCol = col.label;
              log.debug({title: 'searchCol 61',details: searchCol});

              var col_name = col.name;
              log.debug({title: 'col_name',details: col_name});
            
             /* var cust_recId = firstResult.getValue(resultSet.columns[0]);
              log.audit({title: 'cust_recId',details: cust_recId});*/

              var check_box = firstResult.getValue(col);
              log.debug({title: 'check_box ',details: check_box});

              if(searchCol)
               {
                  var field_ID = context.form.getField({id: searchCol});
                  log.debug({title: 'field_ID ',details: field_ID});

                  if((check_box == true)&&(field_ID))
                  {
                    field_ID.updateDisplayType({
                     displayType : serverWidget.FieldDisplayType.HIDDEN
                      });
                  }
              }
          });
        }
      }
      catch(e)
      {
        log.debug({title: 'Error ===> ',details: e});
      }
      
    }
    
  }
  
 return{
 beforeLoad: beforeLoad
 };

});