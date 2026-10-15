package com.photosync.telegram;

import android.app.Application;

public class App extends Application {
    @Override public void onCreate() {
        super.onCreate();
        Notifier.createChannels(this);
    }
}
