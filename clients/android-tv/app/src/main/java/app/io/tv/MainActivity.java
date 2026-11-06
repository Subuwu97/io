package app.io.tv;

import android.app.Activity;
import android.os.*;
import android.graphics.Color;
import android.view.*;
import android.widget.*;
import android.content.SharedPreferences;
import android.security.keystore.*;
import android.util.Base64;
import androidx.media3.common.*;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.PlayerView;
import org.json.*;
import java.net.*;
import java.io.*;
import java.security.KeyStore;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import java.util.*;
import java.util.concurrent.*;

public class MainActivity extends Activity {
 private final Handler ui=new Handler(Looper.getMainLooper());
 private final ExecutorService network=Executors.newSingleThreadExecutor();
 private SharedPreferences prefs; private String base="",token="",pairCode="",pollSecret="",playingId="",playingEpisode="",search="";
 private LinearLayout content; private TextView message; private ExoPlayer player; private long offset; private boolean stopped;
 interface Result { void accept(JSONObject data) throws Exception; }
 @Override public void onCreate(Bundle state){super.onCreate(state);prefs=getSharedPreferences("io-tv",MODE_PRIVATE);base=prefs.getString("server","");try{token=readToken();}catch(Exception ignored){token="";}if(base.isEmpty())setup();else if(token.isEmpty())pair();else catalog(0);}
 private void screen(String title){if(player!=null){saveProgress();player.release();player=null;}ScrollView scroll=new ScrollView(this);content=new LinearLayout(this);content.setOrientation(LinearLayout.VERTICAL);content.setPadding(48,32,48,32);content.setBackgroundColor(Color.rgb(15,14,22));scroll.addView(content);setContentView(scroll);TextView heading=new TextView(this);heading.setText(title);heading.setTextColor(Color.WHITE);heading.setTextSize(30);content.addView(heading);message=new TextView(this);message.setTextColor(Color.LTGRAY);message.setTextSize(18);content.addView(message);}
 private void button(String text,Runnable action){Button b=new Button(this);b.setText(text);b.setAllCaps(false);b.setTextSize(20);content.addView(b,new LinearLayout.LayoutParams(-1,-2));b.setOnClickListener(v->action.run());}
 private JSONObject object(Object... values){JSONObject o=new JSONObject();try{for(int i=0;i<values.length;i+=2)o.put((String)values[i],values[i+1]);}catch(Exception ignored){}return o;}
 private void setup(){screen("I/O TV — connect to your server");EditText address=new EditText(this);address.setText(base);address.setHint("https://your-io-server or http://192.168.1.10:5921");address.setTextColor(Color.WHITE);address.setSingleLine(true);content.addView(address);button("Connect",()->{try{URI u=new URI(address.getText().toString().trim());String host=u.getHost();if(host==null||u.getUserInfo()!=null||u.getQuery()!=null||u.getFragment()!=null||(!u.getPath().isEmpty()&&!u.getPath().equals("/")))throw new Exception("Enter your server address without a path");boolean local=host.equals("localhost")||host.equals("127.0.0.1");String[] octets=host.split("\\.");if(octets.length==4){try{int[] ip=new int[4];boolean valid=true;for(int i=0;i<4;i++){ip[i]=Integer.parseInt(octets[i]);if(ip[i]<0||ip[i]>255)valid=false;}local=local||(valid&&(ip[0]==10||(ip[0]==192&&ip[1]==168)||(ip[0]==172&&ip[1]>=16&&ip[1]<=31)));}catch(NumberFormatException ignored){}};if(!u.getScheme().equals("https")&&!(u.getScheme().equals("http")&&local))throw new Exception("Use HTTPS for a public server");base=u.getScheme()+"://"+u.getRawAuthority();prefs.edit().putString("server",base).apply();token="";pair();}catch(Exception e){message.setText(e.getMessage());}});}
 private void request(String path,String method,JSONObject data,Result result){network.execute(()->{try{HttpURLConnection c=(HttpURLConnection)new URL(base+path).openConnection();c.setInstanceFollowRedirects(false);c.setConnectTimeout(15000);c.setReadTimeout(30000);c.setRequestMethod(method);c.setRequestProperty("Accept","application/json");if(!token.isEmpty())c.setRequestProperty("Authorization","Bearer "+token);if(data!=null){c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");try(OutputStream out=c.getOutputStream()){out.write(data.toString().getBytes("UTF-8"));}}int code=c.getResponseCode();InputStream in=code<400?c.getInputStream():c.getErrorStream();ByteArrayOutputStream bytes=new ByteArrayOutputStream();if(in!=null)try(in){byte[] block=new byte[8192];int n;while((n=in.read(block))!=-1){bytes.write(block,0,n);if(bytes.size()>2*1024*1024)throw new Exception("Server response too large");}}c.disconnect();JSONObject json=new JSONObject(bytes.toString("UTF-8"));if(code>=300)throw new Exception(json.optString("error","Request failed ("+code+")"));ui.post(()->{if(stopped)return;try{result.accept(json);}catch(Exception e){message.setText(e.getMessage());}});}catch(Exception e){ui.post(()->{if(!stopped&&message!=null)message.setText(e.getMessage());});}});}
 private void pair(){screen("Pair I/O TV");button("Change server",this::setup);request("/api/tv-native/pair/start","POST",object("name",Build.MANUFACTURER+" "+Build.MODEL),r->{pairCode=r.getString("code");pollSecret=r.getString("pollSecret");message.setText("On your signed-in phone or computer, open:\n"+base+"/#/tv-pair/"+pairCode+"\n\nCode: "+pairCode+"\nThis code expires in five minutes.");poll();});}
 private void poll(){if(stopped||pairCode.isEmpty())return;request("/api/tv-native/pair/poll","POST",object("code",pairCode,"pollSecret",pollSecret),r->{if(r.optString("status").equals("approved")){token=r.getString("token");saveToken(token);pairCode="";pollSecret="";catalog(0);}else ui.postDelayed(this::poll,3000);});}
 private String enc(String value){try{return java.net.URLEncoder.encode(value,"UTF-8");}catch(Exception e){return "";}}
 private void catalog(int page){screen("I/O TV");EditText query=new EditText(this);query.setText(search);query.setHint("Search your library");query.setSingleLine(true);query.setTextColor(Color.WHITE);content.addView(query);button("Search",()->{search=query.getText().toString();catalog(0);});button("Reconnect / change server",()->{token="";prefs.edit().remove("token").apply();setup();});request("/api/tv-native/catalog?offset="+page+"&q="+enc(search),"GET",null,r->{message.setText("Profile: "+r.optString("profileName"));JSONArray items=r.getJSONArray("items");for(int i=0;i<items.length();i++){JSONObject item=items.getJSONObject(i);button(item.optString("title"),()->title(item.optString("id")));}if(!r.isNull("nextOffset"))button("Next page",()->catalog(r.optInt("nextOffset")));if(page>0)button("Previous page",()->catalog(Math.max(0,page-50)));});}
 private void title(String id){screen("Loading title…");button("Back to library",()->catalog(0));request("/api/tv-native/title/"+enc(id),"GET",null,r->{message.setText(r.optString("title")+"\n\n"+r.optString("description"));JSONObject progress=r.optJSONObject("progress");JSONArray episodes=r.getJSONArray("episodes");for(int i=0;i<episodes.length();i++){JSONObject ep=episodes.getJSONObject(i);String path=ep.getString("path");double resume=progress!=null&&path.equals(progress.optString("episode"))?progress.optDouble("seconds",0):0;button(ep.optString("group")+" · "+ep.optString("title")+(resume>0?" — Resume":""),()->play(id,path,resume));}});}
 private void play(String id,String episode,double start){screen("Preparing playback…");request("/api/tv-native/play","POST",object("id",id,"episode",episode,"offset",start,"quality","720"),r->{playingId=id;playingEpisode=episode;offset=(long)(r.optDouble("startOffsetSeconds",0)*1000);DefaultHttpDataSource.Factory http=new DefaultHttpDataSource.Factory().setDefaultRequestProperties(Collections.singletonMap("Authorization","Bearer "+token));player=new ExoPlayer.Builder(this).setMediaSourceFactory(new DefaultMediaSourceFactory(http)).build();PlayerView view=new PlayerView(this);view.setPlayer(player);view.setKeepScreenOn(true);setContentView(view);player.setMediaItem(MediaItem.fromUri(base+r.getString("playlistUrl")));player.prepare();player.play();view.requestFocus();ui.postDelayed(this::progressTick,15000);});}
 private void progressTick(){if(player==null||stopped)return;saveProgress();ui.postDelayed(this::progressTick,15000);}
 private void saveProgress(){if(player==null||player.getDuration()<=0)return;double seconds=(offset+player.getCurrentPosition())/1000.0,duration=(offset+player.getDuration())/1000.0;request("/api/tv-native/progress","PUT",object("id",playingId,"episode",playingEpisode,"seconds",seconds,"duration",Math.max(seconds,duration)),r->{});}
 private javax.crypto.SecretKey key()throws Exception{KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);if(!store.containsAlias("io-tv")){KeyGenerator gen=KeyGenerator.getInstance("AES","AndroidKeyStore");gen.init(new KeyGenParameterSpec.Builder("io-tv",KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());gen.generateKey();}return(javax.crypto.SecretKey)store.getKey("io-tv",null);}
 private void saveToken(String value)throws Exception{Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());prefs.edit().putString("token",Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(cipher.doFinal(value.getBytes("UTF-8")),Base64.NO_WRAP)).apply();}
 private String readToken()throws Exception{String saved=prefs.getString("token","");if(saved.isEmpty())return "";String[] parts=saved.split(":");Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP)));return new String(cipher.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)),"UTF-8");}
 @Override public void onBackPressed(){if(player!=null){saveProgress();player.release();player=null;title(playingId);}else catalog(0);}
 @Override protected void onStart(){super.onStart();stopped=false;}
 @Override protected void onStop(){saveProgress();stopped=true;ui.removeCallbacksAndMessages(null);if(player!=null){player.release();player=null;}super.onStop();}
 @Override protected void onDestroy(){network.shutdown();super.onDestroy();}
}
