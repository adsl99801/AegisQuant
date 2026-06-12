function checkDates() {
  var now = new Date();
  var iso = now.toISOString().split('T')[0];
  var dateFromIso = new Date(iso);
  
  Logger.log('Now: ' + now);
  Logger.log('ISO String: ' + iso);
  Logger.log('Date from ISO: ' + dateFromIso);
  Logger.log('Timestamp from ISO: ' + (dateFromIso.getTime() / 1000));
  
  // Test Fetch
  var ticker = 'SPY';
  var start = Math.floor(new Date('2026-01-15').getTime() / 1000); // Recent start
  var end = Math.floor(dateFromIso.getTime() / 1000);
  
  var url = 'https://query2.finance.yahoo.com/v8/finance/chart/' + ticker + 
            '?period1=' + start + '&period2=' + end + 
            '&interval=1d&events=history&includeAdjustedClose=true';
            
  Logger.log('Fetch URL: ' + url);
  var response = UrlFetchApp.fetch(url, {muteHttpExceptions: true});
  var content = response.getContentText();
  var json = JSON.parse(content);
  
  if (json.chart && json.chart.result) {
     var timestamps = json.chart.result[0].timestamp;
     if (timestamps && timestamps.length > 0) {
        var lastTs = timestamps[timestamps.length-1];
        var lastDate = new Date(lastTs * 1000);
        Logger.log('Last Data Date: ' + lastDate.toISOString());
     } else {
        Logger.log('No timestamps found');
     }
  } else {
     Logger.log('Fetch Failed');
  }
  
  // Try extending end date
  var tomorrow = new Date(dateFromIso);
  tomorrow.setDate(tomorrow.getDate() + 1);
  var end2 = Math.floor(tomorrow.getTime() / 1000);
  var url2 = 'https://query2.finance.yahoo.com/v8/finance/chart/' + ticker + 
            '?period1=' + start + '&period2=' + end2 + 
            '&interval=1d&events=history&includeAdjustedClose=true';
  
  var response2 = UrlFetchApp.fetch(url2, {muteHttpExceptions: true});
  var json2 = JSON.parse(response2.getContentText());
   if (json2.chart && json2.chart.result) {
     var timestamps = json2.chart.result[0].timestamp;
     if (timestamps && timestamps.length > 0) {
        var lastTs = timestamps[timestamps.length-1];
        var lastDate = new Date(lastTs * 1000);
        Logger.log('Last Data Date (Tomorrow End): ' + lastDate.toISOString());
     }
  }
}
