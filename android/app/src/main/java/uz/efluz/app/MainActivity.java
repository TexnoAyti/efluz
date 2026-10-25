package uz.efluz.app;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import java.io.OutputStream;
import java.security.SecureRandom;
import org.json.JSONObject;

public final class MainActivity extends Activity {
 private static final int PICK_FILE=101,SAVE_FILE=102,MAX_FILE=12*1024*1024;
 private WebView web;private FrameLayout root;private ProgressBar progress;private LinearLayout offline;
 private ValueCallback<Uri[]> fileChooser;private byte[] pendingDownload;
 private volatile String downloadNonce="";private final Handler ui=new Handler(Looper.getMainLooper());
 private final SecureRandom random=new SecureRandom();
 @SuppressLint("SetJavaScriptEnabled") @Override public void onCreate(Bundle saved){
  super.onCreate(saved);getWindow().setStatusBarColor(Color.rgb(8,11,18));getWindow().setNavigationBarColor(Color.rgb(8,11,18));
  root=new FrameLayout(this);root.setBackgroundColor(Color.rgb(8,11,18));web=new WebView(this);web.setBackgroundColor(Color.rgb(244,245,247));root.addView(web,new FrameLayout.LayoutParams(-1,-1));setContentView(root);
  root.setOnApplyWindowInsetsListener((v,insets)->{int l,t,r,b;if(Build.VERSION.SDK_INT>=30){android.graphics.Insets i=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout());l=i.left;t=i.top;r=i.right;b=i.bottom;}else{l=insets.getSystemWindowInsetLeft();t=insets.getSystemWindowInsetTop();r=insets.getSystemWindowInsetRight();b=insets.getSystemWindowInsetBottom();}v.setPadding(l,t,r,b);return insets;});
  progress=new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);progress.setMax(100);root.addView(progress,new FrameLayout.LayoutParams(-1,dp(3)));
  WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);settings.setAllowFileAccess(false);settings.setAllowContentAccess(true);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);settings.setMediaPlaybackRequiresUserGesture(true);settings.setSupportMultipleWindows(true);settings.setJavaScriptCanOpenWindowsAutomatically(false);settings.setUserAgentString(settings.getUserAgentString()+" EFLUZAndroid/1.0.1");if(Build.VERSION.SDK_INT>=26)settings.setSafeBrowsingEnabled(true);
  CookieManager.getInstance().setAcceptCookie(true);CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);web.addJavascriptInterface(new NativeDownload(),"EfluzDownload");
  web.setWebViewClient(new WebViewClient(){
   @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){if(!request.isForMainFrame())return !NavigationPolicy.isAppPage(request.getUrl().toString());return navigate(request.getUrl().toString());}
   @Override public boolean shouldOverrideUrlLoading(WebView view,String url){return navigate(url);}
   @Override public void onPageStarted(WebView view,String url,Bitmap favicon){byte[] n=new byte[24];random.nextBytes(n);downloadNonce=Base64.encodeToString(n,Base64.NO_WRAP|Base64.URL_SAFE);progress.setVisibility(View.VISIBLE);}
   @Override public void onPageFinished(WebView view,String url){progress.setVisibility(View.GONE);CookieManager.getInstance().flush();}
   @Override public void onReceivedSslError(WebView view,SslErrorHandler handler,android.net.http.SslError error){handler.cancel();showOffline("Xavfsiz ulanishni tekshirib bo‘lmadi.");}
   @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){if(request.isForMainFrame())showOffline("Internetga ulanishni tekshiring.");}
  });
  web.setWebChromeClient(new WebChromeClient(){
   @Override public void onProgressChanged(WebView view,int percent){progress.setProgress(percent);if(percent==100)progress.setVisibility(View.GONE);}
   @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){if(!NavigationPolicy.isAppPage(web.getUrl()))return false;if(fileChooser!=null)fileChooser.onReceiveValue(null);fileChooser=callback;Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);String[] types=params.getAcceptTypes();String mime=types.length==1&&!types[0].trim().isEmpty()?types[0]:"image/*";intent.setType(mime);intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);try{startActivityForResult(intent,PICK_FILE);}catch(ActivityNotFoundException e){fileChooser.onReceiveValue(null);fileChooser=null;toast("Fayl tanlash ilovasi topilmadi.");}return true;}
   @Override public boolean onCreateWindow(WebView view,boolean dialog,boolean gesture,android.os.Message message){if(!gesture)return false;WebView popup=new WebView(MainActivity.this);popup.setWebViewClient(new WebViewClient(){private boolean open(String url){if(NavigationPolicy.isAppPage(url))web.loadUrl(url);else external(url);popup.destroy();return true;}@Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return open(r.getUrl().toString());}@Override public boolean shouldOverrideUrlLoading(WebView v,String u){return open(u);}});((WebView.WebViewTransport)message.obj).setWebView(popup);message.sendToTarget();return true;}
   @Override public boolean onJsConfirm(WebView view,String url,String text,JsResult result){if(!NavigationPolicy.isAppPage(url)){result.cancel();return true;}new android.app.AlertDialog.Builder(MainActivity.this).setMessage(text).setPositiveButton("Tasdiqlash",(d,w)->result.confirm()).setNegativeButton("Bekor qilish",(d,w)->result.cancel()).setOnCancelListener(d->result.cancel()).show();return true;}
  });
  web.setDownloadListener((url,agent,disposition,mime,length)->download(url,mime));
  if(saved==null||web.restoreState(saved)==null)web.loadUrl(NavigationPolicy.ORIGIN+"/?androidApp=1");
 }
 private int dp(int value){return Math.round(value*getResources().getDisplayMetrics().density);}
 private boolean navigate(String url){if(NavigationPolicy.isAppPage(url))return false;external(url);return true;}
 private void external(String url){if(!NavigationPolicy.isExternal(url)){toast("Bu havolani ochib bo‘lmaydi.");return;}try{startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE));}catch(ActivityNotFoundException e){toast("Havolani ochadigan ilova topilmadi.");}}
 private void toast(String text){Toast.makeText(this,text,Toast.LENGTH_LONG).show();}
 private void showOffline(String text){ui.post(()->{if(offline!=null)root.removeView(offline);offline=new LinearLayout(this);offline.setOrientation(LinearLayout.VERTICAL);offline.setGravity(android.view.Gravity.CENTER);offline.setPadding(dp(32),dp(32),dp(32),dp(32));offline.setBackgroundColor(Color.rgb(244,245,247));TextView title=new TextView(this);title.setText("EFLUZ");title.setTextSize(28);title.setTextColor(Color.rgb(17,24,39));title.setTypeface(null,android.graphics.Typeface.BOLD);offline.addView(title);TextView copy=new TextView(this);copy.setText(text);copy.setTextSize(14);copy.setPadding(0,dp(16),0,dp(20));offline.addView(copy);Button retry=new Button(this);retry.setText("Qayta urinish");retry.setOnClickListener(v->{root.removeView(offline);offline=null;web.loadUrl(NavigationPolicy.isAppPage(web.getUrl())?web.getUrl():NavigationPolicy.ORIGIN+"/?androidApp=1");});offline.addView(retry);root.addView(offline,new FrameLayout.LayoutParams(-1,-1));progress.setVisibility(View.GONE);});}
 private void download(String url,String mime){
  if(!NavigationPolicy.isAppPage(web.getUrl()))return;
  if(NavigationPolicy.isAppBlob(url)||url.startsWith("data:image/")||url.startsWith("data:application/pdf")){
   String script="(async()=>{try{const b=await(await fetch("+JSONObject.quote(url)+")).blob();if(b.size>"+MAX_FILE+")throw 0;const r=new FileReader();r.onload=()=>EfluzDownload.save("+JSONObject.quote(downloadNonce)+",'EFLUZ',b.type,String(r.result).split(',')[1]);r.readAsDataURL(b);}catch(e){alert('Faylni saqlab bo‘lmadi. Qayta urinib ko‘ring.');}})();";
   web.evaluateJavascript(script,null);
  }else external(url);
 }
 private final class NativeDownload{
  @JavascriptInterface public void save(String nonce,String filename,String mime,String base64){
   if(!downloadNonce.equals(nonce)||!NavigationPolicy.downloadableMime(mime)||base64==null||base64.length()>MAX_FILE*4/3+8)return;
   final byte[] bytes;try{bytes=Base64.decode(base64,Base64.DEFAULT);}catch(IllegalArgumentException e){return;}if(bytes.length<1||bytes.length>MAX_FILE)return;
   ui.post(()->{if(!downloadNonce.equals(nonce)||!NavigationPolicy.isAppPage(web.getUrl())||pendingDownload!=null)return;pendingDownload=bytes;Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(mime).putExtra(Intent.EXTRA_TITLE,NavigationPolicy.fileName(filename,mime));try{startActivityForResult(intent,SAVE_FILE);}catch(ActivityNotFoundException e){pendingDownload=null;toast("Faylni saqlash ilovasi topilmadi.");}});
  }
 }
 @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==PICK_FILE&&fileChooser!=null){Uri uri=result==RESULT_OK&&data!=null?data.getData():null;fileChooser.onReceiveValue(uri==null?null:new Uri[]{uri});fileChooser=null;}if(request==SAVE_FILE){byte[] bytes=pendingDownload;pendingDownload=null;if(result==RESULT_OK&&data!=null&&data.getData()!=null&&bytes!=null){try(OutputStream out=getContentResolver().openOutputStream(data.getData())){if(out==null)throw new java.io.IOException();out.write(bytes);toast("Fayl saqlandi.");}catch(Exception e){toast("Faylni saqlab bo‘lmadi.");}}}}
 @Override protected void onResume(){super.onResume();if(web!=null){web.onResume();web.evaluateJavascript("window.dispatchEvent(new Event('focus'))",null);}}
 @Override protected void onPause(){if(web!=null){CookieManager.getInstance().flush();web.onPause();}super.onPause();}
 @Override public void onBackPressed(){if(web!=null&&web.canGoBack()){web.goBack();}else super.onBackPressed();}
 @Override protected void onSaveInstanceState(Bundle state){super.onSaveInstanceState(state);if(web!=null)web.saveState(state);}
 @Override protected void onDestroy(){if(fileChooser!=null)fileChooser.onReceiveValue(null);if(web!=null){web.removeJavascriptInterface("EfluzDownload");web.destroy();}super.onDestroy();}
}
