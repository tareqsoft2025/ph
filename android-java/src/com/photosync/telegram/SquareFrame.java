package com.photosync.telegram;

import android.content.Context;
import android.widget.FrameLayout;

/** إطار مربع (الارتفاع = العرض). */
final class SquareFrame extends FrameLayout {
    SquareFrame(Context c) { super(c); }

    @Override protected void onMeasure(int w, int h) {
        super.onMeasure(w, w);
        int size = getMeasuredWidth();
        setMeasuredDimension(size, size);
    }
}
