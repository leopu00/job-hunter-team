"""The string literals of a PowerShell script, found without running it (a test reads them to see what the script says by hand).

tokens(source) -> [(kind, start, end, body, line)]; kind: "s" single-quoted (body with '' read as '), "d" double-quoted (body as
written, backtick escapes and the expressions of the script in it), "hs"/"hd" here-strings. Comments are skipped.
"""
import re

def tokens(src):
    """yield (kind, start, end, body, line): kind in s (single), d (double), hs (here single), hd (here double)"""
    i=0;n=len(src);out=[]
    while i<n:
        c=src[i]
        if c=="#":
            j=src.find("\n",i); i=n if j<0 else j; continue
        if src.startswith("<#",i):
            j=src.find("#>",i); i=n if j<0 else j+2; continue
        if c=="@" and src[i+1:i+2] in ("'",'"') and re.match(r"@['\"][ \t]*\r?\n",src[i:i+8]):
            q=src[i+1]; hs=src.index("\n",i)+1
            m=re.compile(r"^%s@"%q,re.M).search(src,hs)
            out.append(("hs" if q=="'" else "hd",i,m.end(),src[hs:m.start()],src.count("\n",0,i)+1)); i=m.end(); continue
        if c=="'":
            j=i+1
            while True:
                k=src.index("'",j)
                if src[k+1:k+2]=="'": j=k+2; continue
                break
            out.append(("s",i,k+1,src[i+1:k].replace("''","'"),src.count("\n",0,i)+1)); i=k+1; continue
        if c=='"':
            j=i+1
            while True:
                if src[j]=="`": j+=2; continue
                if src[j]=='"':
                    if src[j+1:j+2]=='"': j+=2; continue
                    break
                j+=1
            out.append(("d",i,j+1,src[i+1:j],src.count("\n",0,i)+1)); i=j+1; continue
        i+=1
    return out
