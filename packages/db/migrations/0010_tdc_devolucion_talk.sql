-- TDC: "Devolución Talk America" también es tarjeta aprobada (ya pasó por PCBM). La migración 0009 la había
-- dejado en proceso; aquí se corrige lo ya cargado (lo nuevo ya entra así, ver approvedIf en campaigns.ts).
UPDATE bank_sales SET status_class = 'aprobado'
 WHERE campaign = 'tdc' AND status_class = 'en_proceso' AND status_raw NOT LIKE '%RECHAZ%'
   AND (status_raw LIKE '%APROBAD%' OR status_raw LIKE '%ENTREG%' OR status_raw LIKE '%DEVOLU%' OR status_raw LIKE '%DEVUELT%'
        OR status_raw LIKE '%RUTA%' OR status_raw LIKE '%EMBOZ%' OR status_raw LIKE '%EMBOS%' OR status_raw LIKE '%DISTRIBU%');
