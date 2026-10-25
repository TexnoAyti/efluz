import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.File;
import javax.imageio.ImageIO;
/** Build-time launcher layout: preserve the original logo and alpha channel. */
public final class PrepareLauncherIcon {
 public static void main(String[] args)throws Exception{
  BufferedImage source=ImageIO.read(new File(args[0]));int size=512;
  BufferedImage icon=new BufferedImage(size,size,BufferedImage.TYPE_INT_ARGB);
  double fit=(size*.86)/Math.max(source.getWidth(),source.getHeight());
  int w=(int)Math.round(source.getWidth()*fit),h=(int)Math.round(source.getHeight()*fit);
  Graphics2D g=icon.createGraphics();g.setRenderingHint(RenderingHints.KEY_INTERPOLATION,RenderingHints.VALUE_INTERPOLATION_BICUBIC);g.drawImage(source,(size-w)/2,(size-h)/2,w,h,null);g.dispose();
  File output=new File(args[1]);output.getParentFile().mkdirs();ImageIO.write(icon,"png",output);
  if(icon.getRGB(0,0)!=0||Math.abs((double)w/h-(double)source.getWidth()/source.getHeight())>.02)throw new AssertionError("Icon must stay transparent and proportional");
  System.out.println("Launcher: transparent 512x512, original logo aspect ratio preserved ("+w+"x"+h+")");
 }
}
