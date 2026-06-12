/**
 * RebalanceExecutor.gs
 * 執行再平衡交易命令
 */
var RebalanceExecutor = {

  execute: function(portfolio, targetWeights, day, executionPrices) {
    if (!day) return { totalCost: 0, actionLog: "" };

    var totalCost = 0;
    var actionLog = [];
    var currentVal = portfolio.updateValue(day);
    
    // 1. Calculate Target Amounts
    // Need to sell first to free up cash
    var sellOrders = [];
    var buyOrders = [];

    Constants.TICKERS.forEach(function(t) {
       var price = (executionPrices && executionPrices[t]) ? executionPrices[t] : (day[t] ? day[t].close : 0);
       // Safety check: skip invalid prices
       if (price <= 0 || !isFinite(price)) return;

       var targetPct = targetWeights[t] || 0;
       var targetVal = currentVal * targetPct;
       // PRECISION FIX: Add epsilon to prevent floor(11.9999) = 11 when it should be 12
       var targetShares = Math.floor((targetVal / price) + 0.0001);
       var currentShares = portfolio.holdings[t] || 0;
       
       var diff = targetShares - currentShares;
       
       // PRECISION FIX: Ignore tiny trades (e.g. < $1) to prevent "Sell 1 share" due to float matching
       // If diff is exactly -1 but value diff is very small, force diff = 0
       var valueDiff = Math.abs(diff * price);
       if (valueDiff < 5.0) { // Tolerance $5
          diff = 0;
       }
       
       if (diff < 0) {
         sellOrders.push({ ticker: t, amount: diff, price: price });
       } else if (diff > 0) {
         buyOrders.push({ ticker: t, amount: diff, price: price });
       }
    });

    // 2. Execute Sells
    sellOrders.forEach(function(order) {
       var t = order.ticker;
       var diff = order.amount; // negative
       var absSell = -diff;
       var price = order.price;
       
       var tradeVal = absSell * price;
       var commission = Math.max(Constants.COST_CONFIG.MIN_PER_ORDER, absSell * Constants.COST_CONFIG.PER_SHARE);
       var tax = tradeVal * Constants.COST_CONFIG.REBALANCE_TAX_RATE;
       var totalFee = commission + tax;
       
       // PnL Calculation
       var avgCost = portfolio.avgCosts[t] || 0;
       var pnl = (price - avgCost) * absSell;
       var pnlPct = (avgCost > 0) ? (price - avgCost)/avgCost : 0;
       var winLoss = pnl >= 0 ? "獲利" : "虧損";

       portfolio.holdings[t] += diff;
       portfolio.cash += (tradeVal - totalFee);
       totalCost += totalFee;
       
       if (portfolio.holdings[t] === 0) {
          portfolio.avgCosts[t] = 0;
       }
       
       var weightPct = (tradeVal / currentVal) * 100;
       actionLog.push("賣出 " + absSell + " (" + weightPct.toFixed(1) + "%) " + t + " @ " + price.toFixed(2) + 
                       " (" + winLoss + " " + (pnlPct*100).toFixed(1) + "%, 費 " + totalFee.toFixed(2) + ")");
    });

    // 3. Execute Buys
    buyOrders.forEach(function(order) {
       var t = order.ticker;
       var diff = order.amount; // positive
       var price = order.price;
       
       var tradeVal = diff * price;
       var commission = Math.max(Constants.COST_CONFIG.MIN_PER_ORDER, diff * Constants.COST_CONFIG.PER_SHARE);
       var tax = tradeVal * Constants.COST_CONFIG.REBALANCE_TAX_RATE;
       var totalFee = commission + tax;
       
       if (portfolio.cash >= (tradeVal + totalFee)) {
          var oldShares = portfolio.holdings[t] || 0;
          var oldCost = portfolio.avgCosts[t] || 0;
          var totalShares = oldShares + diff;
          
          // Weighted Average Cost
          var newAvgCost = 0;
          if (totalShares > 0) {
             newAvgCost = ((oldShares * oldCost) + (diff * price)) / totalShares;
             if (!isFinite(newAvgCost)) newAvgCost = price;
          }
          
          portfolio.holdings[t] = totalShares;
          portfolio.avgCosts[t] = newAvgCost;
          portfolio.cash -= (tradeVal + totalFee);
          totalCost += totalFee;
          
          var weightPct = (tradeVal / currentVal) * 100;
          actionLog.push("買入 " + diff + " (" + weightPct.toFixed(1) + "%) " + t + " @ " + price.toFixed(2) + " (費 " + totalFee.toFixed(2) + ")");
       } else {
          // Not enough cash logic (buy max possible)
          var maxAfford = Math.floor((portfolio.cash - Constants.COST_CONFIG.MIN_PER_ORDER) / (price * (1 + Constants.COST_CONFIG.REBALANCE_TAX_RATE + Constants.COST_CONFIG.PER_SHARE/price))); 
          // Simplified Max Check
          if (maxAfford > 0) {
             diff = maxAfford;
             tradeVal = diff * price;
             commission = Math.max(Constants.COST_CONFIG.MIN_PER_ORDER, diff * Constants.COST_CONFIG.PER_SHARE);
             tax = tradeVal * Constants.COST_CONFIG.REBALANCE_TAX_RATE;
             totalFee = commission + tax;
             
             if (portfolio.cash >= (tradeVal + totalFee)) {
                var oldShares = portfolio.holdings[t] || 0;
                var oldCost = portfolio.avgCosts[t] || 0;
                var totalShares = oldShares + diff;
                
                var newAvgCost = 0;
                if (totalShares > 0) {
                   newAvgCost = ((oldShares * oldCost) + (diff * price)) / totalShares;
                   if (!isFinite(newAvgCost)) newAvgCost = price;
                }
                
                portfolio.holdings[t] = totalShares;
                portfolio.avgCosts[t] = newAvgCost;
                portfolio.cash -= (tradeVal + totalFee);
                totalCost += totalFee;
                var weightPct = (tradeVal / currentVal) * 100;
                actionLog.push("買入 " + diff + " (" + weightPct.toFixed(1) + "%) " + t + " @ " + price.toFixed(2) + " (費 " + totalFee.toFixed(2) + ", 現金不足調整)");
             }
          } else {
             actionLog.push("⚠️現金不足買入" + t + ": 需$" + (tradeVal+totalFee).toFixed(0) + "(1股$" + price.toFixed(0) + ") > 剩餘$" + portfolio.cash.toFixed(0));
          }
       }
    });
    
    return {
      totalCost: totalCost,
      actionLog: actionLog.join("; ")
    };
  }
};
