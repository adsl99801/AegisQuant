/**
 * ScoringEngine.gs
 * 負責動態評分邏輯
 */
var ScoringEngine = {
  calculateScores: function(historySlice, currentIndex) {
    var scores = [];
    
    // 準備資料切片
    // 1個月 ~ 21天, 3個月 ~ 63天
    var slice1m = ScoringEngine._getSlice(historySlice, currentIndex, 21);
    var slice3m = ScoringEngine._getSlice(historySlice, currentIndex, 63);
    
    // 計算 Sharpe 用於正規化
    var sharpes = [];
    // 計算 Sharpe 用於正規化
    var sharpes = [];
    var scoreTickers = Constants.TICKERS;
    
    scoreTickers.forEach(function(t) {
      sharpes.push({t: t, val: Utils.calculateSharpe(slice3m, t)});
    });
    var maxSharpe = Math.max.apply(null, sharpes.map(function(s) { return s.val; }));
    
    scoreTickers.forEach(function(t) {
      var score = 0;
      // 1. 近1個月報酬 > 0
      if (Utils.calculateReturns(slice1m, t) > 0) score += 1;
      
      // 2. 近3個月報酬 > 0
      if (Utils.calculateReturns(slice3m, t) > 0) score += 1;
      
      // 3. 夏普比率正規化
      var sVal = sharpes.find(function(s) { return s.t === t; }).val;
      if (maxSharpe > 0 && sVal > 0) score += (sVal / maxSharpe);
      
      // 4. 相對 SPY 超額報酬
      var retT = Utils.calculateReturns(slice3m, t);
      var retB = Utils.calculateReturns(slice3m, Constants.BENCHMARK);
      if (retT > retB) score += 1;
      
      scores.push({ ticker: t, score: score });
    });
    
    // 排序
    scores.sort(function(a, b) { return b.score - a.score; });
    return scores;
  },
  
  _getSlice: function(history, index, days) {
    return history.slice(Math.max(0, index - days + 1), index + 1);
  }
};
