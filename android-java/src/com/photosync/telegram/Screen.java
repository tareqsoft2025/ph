package com.photosync.telegram;

import android.content.Intent;
import android.view.View;

abstract class Screen {
    protected final MainActivity a;

    Screen(MainActivity a) { this.a = a; }

    abstract View view();
    void onShow() {}
    void onHide() {}
    void onPermissions(int req) {}
    void onResult(int req, int res, Intent data) {}
}
