/**
 * Notifier.gs
 * 通知模組
 */
var Notifier = {
  alert: function(msg) {
    try {
      SpreadsheetApp.getUi().alert(msg);
    } catch (e) {
      LoggerWrapper.log('Alert (UI unavailable): ' + msg);
    }
  },
  log: function(msg) {
    LoggerWrapper.log(msg);
  },
  
  sendEmail: function(subject, body) {
    if (Constants.NOTIFICATION_EMAIL) {
      try {
        LoggerWrapper.log('準備發送 Email - 主旨: ' + subject);
        LoggerWrapper.log('Email 內容: ' + body);
        MailApp.sendEmail({
          to: Constants.NOTIFICATION_EMAIL,
          subject: subject,
          htmlBody: body
        });
        LoggerWrapper.log('Email 已成功發送');
      } catch (e) {
        LoggerWrapper.error('寄信失敗: ' + e);
      }
    }
  }
};
