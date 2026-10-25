import uz.efluz.app.NavigationPolicy;
public class NavigationPolicyTest {
 static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
 public static void main(String[] args){
  check(NavigationPolicy.isAppPage("https://efluz.vercel.app/teams/tp_example?tab=standings"),"App navigation");
  for(String url:new String[]{"http://efluz.vercel.app/","https://efluz.vercel.app.evil.test/","https://efluz.vercel.app@evil.test/","https://efluz.vercel.app:444/","javascript:alert(1)","file:///etc/passwd","content://private/","intent://efluz.vercel.app/"})check(!NavigationPolicy.isAppPage(url),"Untrusted app URL: "+url);
  check(NavigationPolicy.isExternal("https://t.me/efluzbot?start=android_123"),"Telegram deep link");check(NavigationPolicy.isExternal("tg://resolve?domain=efluzbot"),"Native Telegram");
  for(String url:new String[]{"javascript:alert(1)","file:///etc/passwd","intent://evil/#Intent;scheme=file;end","https://user:password@example.test/"})check(!NavigationPolicy.isExternal(url),"Unsafe external URL");
  check(NavigationPolicy.isAppBlob("blob:https://efluz.vercel.app/example"),"Owned export");check(!NavigationPolicy.isAppBlob("blob:https://evil.test/example"),"Foreign export");
  check(NavigationPolicy.downloadableMime("image/png")&&!NavigationPolicy.downloadableMime("application/vnd.android.package-archive"),"Bounded export types");check(!NavigationPolicy.fileName("../../outside","image/png").contains("/"),"Export name cannot escape");
  System.out.println("PASS native Android URL isolation, Telegram links, unsafe schemes, owned blob exports and file names");
 }
}
