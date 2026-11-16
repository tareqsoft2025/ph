package com.ph.restaurant;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * يتحقق من وجود إعدادات Firebase (google-services.json) داخل التطبيق.
 * بدونها يتوقف التطبيق إذا حاولنا تسجيل الإشعارات الفورية، لذلك نتحقق أولاً.
 */
@CapacitorPlugin(name = "FirebaseCheck")
public class FirebaseCheckPlugin extends Plugin {
    @PluginMethod
    public void isAvailable(PluginCall call) {
        int id = getContext().getResources().getIdentifier("google_app_id", "string", getContext().getPackageName());
        JSObject ret = new JSObject();
        ret.put("available", id != 0);
        call.resolve(ret);
    }
}
