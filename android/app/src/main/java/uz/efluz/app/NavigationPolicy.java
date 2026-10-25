package uz.efluz.app;
import java.net.URI;
/** URL decisions do not depend on a display string or an untrusted prefix. */
public final class NavigationPolicy {
 public static final String ORIGIN="https://efluz.vercel.app";
 private NavigationPolicy(){}
 public static boolean isAppPage(String value){try{URI u=new URI(value);return "https".equalsIgnoreCase(u.getScheme())&&"efluz.vercel.app".equalsIgnoreCase(u.getHost())&&u.getUserInfo()==null&&(u.getPort()==-1||u.getPort()==443);}catch(Exception e){return false;}}
 public static boolean isExternal(String value){try{URI u=new URI(value);String scheme=u.getScheme();return u.getUserInfo()==null&&(("https".equalsIgnoreCase(scheme)&&u.getHost()!=null)||("tg".equalsIgnoreCase(scheme)&&("resolve".equals(u.getHost())||"user".equals(u.getHost())||"msg_url".equals(u.getHost()))));}catch(Exception e){return false;}}
 public static boolean isAppBlob(String value){return value!=null&&value.startsWith("blob:"+ORIGIN+"/");}
 public static boolean downloadableMime(String mime){return "image/png".equals(mime)||"image/jpeg".equals(mime)||"image/webp".equals(mime)||"application/pdf".equals(mime);}
 public static String fileName(String name,String mime){String n=(name==null?"":name).replaceAll("[^\\p{L}\\p{N}._ -]","_").replace("..","").trim();if(n.length()>80)n=n.substring(0,80);if(n.isEmpty())n="EFLUZ";String ext="application/pdf".equals(mime)?".pdf":"image/jpeg".equals(mime)?".jpg":"image/webp".equals(mime)?".webp":".png";return n.toLowerCase(java.util.Locale.ROOT).endsWith(ext)?n:n+ext;}
}
