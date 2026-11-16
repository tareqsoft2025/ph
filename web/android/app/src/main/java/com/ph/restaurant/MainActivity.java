package com.ph.restaurant;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FirebaseCheckPlugin.class);
        registerPlugin(SecureLocationPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
